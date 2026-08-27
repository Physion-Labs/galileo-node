/**
 * One error class per thing a caller might actually do about it.
 *
 * The split is by REACTION, not by status code. `RateLimitError` and
 * `InsufficientCreditsError` are both "we refused you", but one clears on its own
 * and the other needs somebody to buy credits — catching them separately is the
 * difference between a batch that pauses and a batch that stops.
 */

import type { ApiErrorBody, ErrorCode, ErrorType } from "./types.js";

export interface ApiErrorInit {
  status: number;
  type: ErrorType | string;
  code: ErrorCode | string;
  message: string;
  requestId?: string | undefined;
  headers?: Headers | undefined;
}

/**
 * Base class for everything this client throws.
 *
 * Catch this to catch anything — including the failures where the API never
 * answered. That is the whole reason it is separate from `APIError` below: a
 * caller who wants "something went wrong in the client" and a caller who wants
 * "the server said no" are asking different questions, and only the second one
 * has a status code.
 *
 * The Python client draws the same line with the same two names.
 */
export class GalileoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The API answered, and the answer was a refusal. */
export class APIError extends GalileoError {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  /** Quote this when asking us about a specific failure. */
  readonly requestId: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.type = init.type;
    this.code = init.code;
    this.requestId = init.requestId;
  }
}

/** The request was wrong: bad body, unsupported codec, video too large. */
export class InvalidRequestError extends APIError {}

/** The key is missing, malformed, or revoked. */
export class AuthenticationError extends APIError {}

/** No such evaluation or video, or not yours. */
export class NotFoundError extends APIError {}

/**
 * Out of credits. Retrying cannot help; the balance has to change.
 */
export class InsufficientCreditsError extends APIError {}

/**
 * Too many requests. Unlike the others this one clears by waiting, and
 * `retryAfterMs` says how long the server asked for.
 *
 * The client already waits and retries within its rate-limit budget, so seeing
 * this means the budget was exhausted rather than that nothing was tried.
 */
export class RateLimitError extends APIError {
  readonly retryAfterMs: number | undefined;

  constructor(init: ApiErrorInit & { retryAfterMs?: number | undefined }) {
    super(init);
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** Our fault: 5xx, or a model that answered unusably. */
export class ServerError extends APIError {}

/**
 * The request never got an answer: DNS, TCP, TLS, a timeout, an aborted signal.
 *
 * Separate from `ServerError` because the two differ in what is safe to assume.
 * A 500 means the server received the request and may have acted on it; this
 * means we do not know whether it arrived at all.
 */
export class ConnectionError extends GalileoError {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/**
 * A poll that ran out of patience before the evaluation settled.
 *
 * The job is still running — retrieve it again later rather than resubmitting,
 * since a second submission is a second charge.
 *
 * Named for polling rather than `TimeoutError`, for two reasons: `TimeoutError`
 * is also a DOM global, and a request-level timeout does not arrive here at all
 * — it surfaces as `ConnectionError`, because a request that timed out may still
 * have been acted on. This is the Python client's name for the same class.
 */
export class PollTimeoutError extends GalileoError {}

const BY_STATUS: Record<number, new (init: ApiErrorInit) => APIError> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  403: AuthenticationError,
  404: NotFoundError,
  402: InsufficientCreditsError,
  413: InvalidRequestError,
  422: InvalidRequestError,
};

/**
 * Build the right error from a response the server refused with.
 *
 * The body is not trusted to be well-formed: an error can come from a proxy, a
 * load balancer, or a crash that never reached the application, and those answer
 * with HTML or nothing at all. Status is always available; everything else is a
 * best effort.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
): APIError {
  const parsed = (body as { error?: Partial<ApiErrorBody> } | null)?.error;
  const init: ApiErrorInit = {
    status,
    type: parsed?.type ?? (status >= 500 ? "api_error" : "invalid_request_error"),
    code: parsed?.code ?? `http_${status}`,
    message: parsed?.message ?? `Galileo returned ${status}.`,
    requestId: parsed?.request_id ?? headers.get("x-request-id") ?? undefined,
    headers,
  };

  if (status === 429) {
    return new RateLimitError({ ...init, retryAfterMs: retryAfterMs(headers) });
  }
  const Specific = BY_STATUS[status];
  if (Specific) return new Specific(init);
  return new ServerError(init);
}

/**
 * `Retry-After`, in milliseconds, or undefined when the server did not say.
 *
 * The header is defined as either a number of seconds or an HTTP date, and both
 * appear in the wild. A date in the past yields 0 rather than a negative wait.
 */
export function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - Date.now());
}
