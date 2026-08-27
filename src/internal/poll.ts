/**
 * Wait for something asynchronous to settle.
 *
 * Backs off rather than polling at a fixed rate: an evaluation that finishes in
 * two seconds should be noticed quickly, and one that takes three minutes should
 * not be asked about ninety times.
 */

import { PollTimeoutError } from "../errors.js";

export interface PollOptions {
  /** Give up after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** First gap between polls. Default 1s. */
  initialIntervalMs?: number;
  /** Longest gap between polls. Default 8s. */
  maxIntervalMs?: number;
  signal?: AbortSignal | undefined;
}

export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  settled: (value: T) => boolean,
  opts: PollOptions & { describe: string; statusOf?: (value: T) => string },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const maxIntervalMs = opts.maxIntervalMs ?? 8_000;
  let interval = opts.initialIntervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await fetchOnce();
    if (settled(value)) return value;

    if (Date.now() + interval > deadline) {
      const status = opts.statusOf?.(value);
      throw new PollTimeoutError(
        `${opts.describe} did not settle within ${Math.round(timeoutMs / 1000)}s` +
          (status ? ` (last status: ${status})` : "") +
          ". It is still running; retrieve it again later.",
      );
    }
    await sleep(interval, opts.signal);
    interval = Math.min(interval * 1.5, maxIntervalMs);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted."));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Aborted."));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
