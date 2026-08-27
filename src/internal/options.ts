/**
 * Options every call accepts.
 *
 * `signal?: AbortSignal | undefined` rather than `signal?: AbortSignal`, and the
 * difference is not decorative: under `exactOptionalPropertyTypes` the second
 * form rejects `{ signal: maybeUndefined }`, which is exactly how a caller
 * forwards an optional signal down a chain. Writing it out here once keeps that
 * from being rediscovered at every call site.
 */
export interface RequestOptions {
  signal?: AbortSignal | undefined;
}
