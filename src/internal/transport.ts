/**
 * HTTP: auth, timeouts, retries, rate-limit backoff, bounded concurrency.
 *
 * A browser calling this API one page at a time needs none of this. A server
 * pushing a few hundred clips through it needs all of it, and needs it to be the
 * same on every call rather than remembered at each call site.
 */

import { ConnectionError, errorFromResponse, retryAfterMs } from "../errors.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TransportOptions {
  apiKey: string;
  baseURL: string;
  /** Per-attempt deadline. Default 60s. */
  timeoutMs?: number;
  /**
   * Attempts after the first, for failures that might not repeat. Default 2.
   *
   * Rate limiting is NOT one of those failures — see `rateLimitBudgetMs`.
   */
  maxRetries?: number;
  /**
   * Total time to spend waiting out 429s, per request. Default 60s.
   *
   * Deliberately a separate budget from `maxRetries`, because a rate-limit reply
   * is flow control rather than failure. Charged to the retry count, a batch
   * larger than that count would fail on its own tail: submit ten things against
   * a limit that admits two per minute and the last of them must wait minutes,
   * which no sane retry count covers.
   */
  rateLimitBudgetMs?: number;
  /**
   * Requests allowed in flight at once. Default 4.
   *
   * Node has no built-in for this, and the alternative is worse than it looks:
   * `Promise.all` over two hundred clips opens two hundred sockets, most of which
   * come straight back 429 and spend the rate-limit budget on requests that were
   * never going to be admitted.
   */
  maxConcurrency?: number;
  /** Override for tests, or for a runtime whose global fetch is unusual. */
  fetch?: FetchLike;
}

export interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path under `baseURL`. Omit only when giving `absoluteURL` instead. */
  path?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Raw bytes instead of JSON — for a small upload PUT. */
  rawBody?: Uint8Array;
  /**
   * A stream instead of JSON, for an upload that should not be buffered.
   *
   * `contentLength` is mandatory alongside it. A streamed body has no length of
   * its own, and the receiver must be able to refuse an oversized upload before
   * storing it rather than after — so a request that cannot declare its size is
   * refused outright.
   */
  rawStream?: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  signal?: AbortSignal | undefined;
  /**
   * Send no `Authorization` header.
   *
   * Required for an upload PUT: that request goes to storage rather than to this
   * API, and a key sent to a host that did not need it is a key disclosed.
   */
  anonymous?: boolean;
  /** Absolute URL to use instead of `baseURL` — again, uploads. */
  absoluteURL?: string;
  /** Per-call override. Uploads use 0: re-sending tens of megabytes is not free. */
  maxRetries?: number;
}

/**
 * Codes that are terminal despite a retryable status.
 *
 * `model_output_invalid` is a 502: the model answered, and answered unusably.
 * The same input produces the same unusable answer, so a retry cannot change the
 * outcome — and the run is metered, so it would spend the caller's credits again
 * on a failure that is already decided.
 *
 * `model_timeout` (504) is deliberately absent. There the model was still
 * working when the gateway gave up, and a second attempt may well land.
 */
const TERMINAL_CODES = new Set(["model_output_invalid", "unsupported_codec", "file_too_large"]);

const RETRYABLE_STATUS = new Set([408, 409, 500, 502, 503, 504]);

/** Bounded-concurrency gate. Resolves when a slot is free. */
class Gate {
  #inFlight = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.#inFlight >= this.limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#inFlight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#inFlight--;
      this.#waiting.shift()?.();
    };
  }
}

export class Transport {
  readonly #apiKey: string;
  readonly #baseURL: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #rateLimitBudgetMs: number;
  readonly #fetch: FetchLike;
  readonly #gate: Gate;

  constructor(opts: TransportOptions) {
    this.#apiKey = opts.apiKey;
    this.#baseURL = opts.baseURL.replace(/\/+$/, "");
    this.#timeoutMs = opts.timeoutMs ?? 60_000;
    this.#maxRetries = opts.maxRetries ?? 2;
    this.#rateLimitBudgetMs = opts.rateLimitBudgetMs ?? 60_000;
    this.#gate = new Gate(opts.maxConcurrency ?? 4);
    const impl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!impl) {
      throw new Error("No fetch available. Use Node 20 or newer, or pass `fetch`.");
    }
    this.#fetch = impl;
  }

  /** Send a request and parse a JSON reply. */
  async json<T>(spec: RequestSpec): Promise<T> {
    const res = await this.send(spec);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Send a request, returning the raw response. Errors are already thrown. */
  async send(spec: RequestSpec): Promise<Response> {
    const release = await this.#gate.acquire();
    try {
      return await this.#attempt(spec);
    } finally {
      release();
    }
  }

  async #attempt(spec: RequestSpec): Promise<Response> {
    const url = this.#url(spec);
    const maxRetries = spec.maxRetries ?? this.#maxRetries;
    let rateLimitSpent = 0;
    let attempt = 0;

    for (;;) {
      const { signal, done } = withTimeout(this.#timeoutMs, spec.signal);
      let res: Response;
      try {
        res = await this.#fetch(url, this.#init(spec, signal));
      } catch (cause) {
        done();
        if (spec.signal?.aborted) throw new ConnectionError("Request aborted.", cause);
        if (attempt < maxRetries) {
          attempt++;
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ConnectionError(`Could not reach Galileo at ${url}.`, cause);
      }
      done();

      if (res.ok) return res;

      // Rate limiting draws on its own budget, so a long queue does not consume
      // the attempts reserved for failures that might not repeat.
      if (res.status === 429) {
        const wait = retryAfterMs(res.headers) ?? backoffMs(attempt + 1);
        if (rateLimitSpent + wait <= this.#rateLimitBudgetMs) {
          rateLimitSpent += wait;
          await sleep(wait);
          continue;
        }
        throw await asError(res);
      }

      const err = await asError(res);
      if (attempt < maxRetries && RETRYABLE_STATUS.has(res.status) && !TERMINAL_CODES.has(err.code)) {
        attempt++;
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }

  #url(spec: RequestSpec): string {
    if (!spec.absoluteURL && spec.path === undefined) {
      throw new Error("A request needs either `path` or `absoluteURL`.");
    }
    const base = spec.absoluteURL ?? `${this.#baseURL}${spec.path}`;
    if (!spec.query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(spec.query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
  }

  #init(spec: RequestSpec, signal: AbortSignal): RequestInit {
    const headers: Record<string, string> = { accept: "application/json" };
    if (!spec.anonymous) headers.authorization = `Bearer ${this.#apiKey}`;

    // Not `BodyInit`: that is a DOM global, and pulling `lib: DOM` in for one
    // alias would put every browser global in scope for a Node-only client.
    let body: RequestInit["body"];
    let stream = false;
    if (spec.rawStream) {
      if (spec.contentLength === undefined) {
        throw new Error("rawStream requires contentLength.");
      }
      body = spec.rawStream as unknown as RequestInit["body"];
      stream = true;
      headers["content-type"] = spec.contentType ?? "application/octet-stream";
      headers["content-length"] = String(spec.contentLength);
    } else if (spec.rawBody) {
      body = spec.rawBody as unknown as RequestInit["body"];
      headers["content-type"] = spec.contentType ?? "application/octet-stream";
      // Declared explicitly: a receiver that has to refuse an oversized body
      // before storing it cannot do so without knowing the size up front.
      headers["content-length"] = String(spec.rawBody.byteLength);
    } else if (spec.body !== undefined) {
      body = JSON.stringify(spec.body);
      headers["content-type"] = "application/json";
    }

    // `body` is attached only when there is one. Under
    // `exactOptionalPropertyTypes` an explicit `body: undefined` is not the same
    // as an absent one, and `fetch` is typed for the absent case.
    const init: RequestInit = { method: spec.method, headers, signal };
    if (body !== undefined) init.body = body;
    // `duplex: "half"` is required by Node's fetch for any stream body and is
    // absent from the RequestInit type, hence the cast. Without it the request
    // throws before a byte is sent.
    if (stream) (init as RequestInit & { duplex?: string }).duplex = "half";
    return init;
  }
}

async function asError(res: Response) {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A proxy, a load balancer or a crash that never reached the application
    // answers with HTML or with nothing. Status still tells us what to throw.
  }
  return errorFromResponse(res.status, body, res.headers);
}

/** Exponential, with jitter so a batch that fails together does not retry together. */
function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 8_000);
  return base + Math.random() * base * 0.25;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A per-attempt deadline that also respects the caller's signal.
 *
 * `done()` must be called on every path: an uncleared timer keeps the process
 * alive, which turns a finished script into one that hangs for a minute.
 */
function withTimeout(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = () => controller.abort();
  external?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", forward);
    },
  };
}
