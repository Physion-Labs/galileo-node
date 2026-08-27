/** Submit videos and read back what Galileo found. */

import type { Transport } from "../internal/transport.js";
import { pollUntil, type PollOptions } from "../internal/poll.js";
import type { RequestOptions } from "../internal/options.js";
import type { Evaluation, EvaluationCreateParams, EvaluationList, EvaluationStatus } from "../types.js";

/**
 * An evaluation stops changing at one of these.
 *
 * `partial` is terminal and is not an error: one detector finished and another
 * did not. The result carries what was found, and `detectors` says which of them
 * to trust — so a caller that waits for `completed` alone waits forever.
 */
const SETTLED: EvaluationStatus[] = ["completed", "partial", "failed"];

export class Evaluations {
  constructor(private readonly transport: Transport) {}

  /**
   * Queue an evaluation. Returns immediately, in `queued`.
   *
   * Use `createAndWait` unless you have your own polling.
   */
  async create(params: EvaluationCreateParams, opts: RequestOptions = {}): Promise<Evaluation> {
    return this.transport.json<Evaluation>({
      method: "POST",
      path: "/v1/evaluations",
      body: params,
      signal: opts.signal,
      // NEVER RETRIED, and this is the single most expensive default in the
      // client to get wrong.
      //
      // Submission is not idempotent: the API has no idempotency key, and
      // repeating the same (video, prompt, model, detectors) files a SECOND run
      // with its own id and its own charge. So every failure that leaves the
      // outcome unknown — a 500, a connection reset, a timeout — is a failure
      // where the run may already exist and already be paid for. Retrying then
      // does not recover the request; it buys the same evaluation twice.
      //
      // Rate limiting is unaffected: a 429 is the server declining to create
      // anything, which is knowledge rather than ambiguity, so the transport's
      // 429 wait still applies here and is bounded separately.
      //
      // `retry()` below is the opposite case and IS retried — it is idempotent
      // on the run being retried.
      maxRetries: 0,
    });
  }

  async retrieve(id: string, opts: RequestOptions = {}): Promise<Evaluation> {
    return this.transport.json<Evaluation>({
      method: "GET",
      path: `/v1/evaluations/${encodeURIComponent(id)}`,
      signal: opts.signal,
    });
  }

  /**
   * Your evaluations, newest first.
   *
   * `offset` addresses a page directly, and the response's `counts` is what tells
   * you when to stop: the `limit` caps one response at 100, so deciding you have
   * reached the end because a page came back short is wrong at exactly the
   * boundary where it matters.
   */
  async list(
    params: {
      limit?: number;
      offset?: number;
      video_id?: string;
      /** Keep only these statuses. Sent comma-joined, which the API accepts. */
      status?: EvaluationStatus[];
    } = {},
    opts: RequestOptions = {},
  ): Promise<EvaluationList> {
    return this.transport.json<EvaluationList>({
      method: "GET",
      path: "/v1/evaluations",
      query: {
        limit: params.limit,
        offset: params.offset,
        video_id: params.video_id,
        status: params.status?.length ? params.status.join(",") : undefined,
      },
      signal: opts.signal,
    });
  }

  /**
   * Walk every page, so a caller does not have to hold the offset arithmetic.
   *
   * Stops on `counts` rather than on a short page. Yields evaluations one at a
   * time: a large account is exactly the case this exists for, and materialising
   * it into one array would undo the point.
   */
  async *iterate(
    params: { pageSize?: number; video_id?: string; status?: EvaluationStatus[] } = {},
    opts: RequestOptions = {},
  ): AsyncGenerator<Evaluation, void, undefined> {
    const limit = Math.min(100, Math.max(1, params.pageSize ?? 100));
    let offset = 0;
    for (;;) {
      const page = await this.list({ ...params, limit, offset }, opts);
      for (const evaluation of page.data) yield evaluation;

      // `counts` is a census over the owner and video scope that IGNORES `status`
      // — the contract is explicit about it. So summing the whole thing is the
      // size of the unfiltered set, and using it while filtering would walk past
      // the end of the filtered one, asking for pages that come back empty.
      //
      // Selecting the requested statuses out of the census is the total that
      // matches what is being paged. Without a filter, that is every key, which
      // is the same sum as before.
      const total = page.counts ? countFor(page.counts, params.status) : undefined;
      offset += page.data.length;
      if (page.data.length === 0) return;
      if (total !== undefined ? offset >= total : page.data.length < limit) return;
    }
  }

  /**
   * Run a failed evaluation again. Returns the NEW evaluation, queued.
   *
   * The only idempotent submission in this API, and it is idempotent on the run
   * being retried rather than on your request: press it in a burst and every
   * caller is handed the same successor. `create` has no such guarantee, so this
   * is the safe way to react to a failure.
   *
   * It costs the ordinary price, which is not paying twice — the failed run was
   * refunded when it settled, and whichever detectors did land were cached, so
   * only the missing ones are bought again.
   *
   * Throws `InvalidRequestError` when there is nothing to retry: the run has not
   * finished, it did not fail, it delivered everything asked of it, it analyzed
   * no stored clip, it has been attempted too many times, or its earlier retry
   * was deleted. The message says which.
   */
  // Deliberately WITHOUT `maxRetries: 0`, unlike `create`. This one is
  // idempotent on the run being retried — the server claims the predecessor's
  // `retried_by` once, so a repeated call is handed the same successor rather
  // than filing a second one. Retrying an ambiguous failure here is safe, and
  // it is the case where a caller most wants it: they are already recovering
  // from something that went wrong.
  async retry(id: string, opts: RequestOptions = {}): Promise<Evaluation> {
    return this.transport.json<Evaluation>({
      method: "POST",
      path: `/v1/evaluations/${encodeURIComponent(id)}/retry`,
      signal: opts.signal,
    });
  }

  async delete(id: string, opts: RequestOptions = {}): Promise<void> {
    await this.transport.send({
      method: "DELETE",
      path: `/v1/evaluations/${encodeURIComponent(id)}`,
      signal: opts.signal,
    });
  }

  /** Poll an existing evaluation until it stops changing. */
  async waitUntilSettled(id: string, opts: PollOptions = {}): Promise<Evaluation> {
    return pollUntil<Evaluation>(
      () => this.retrieve(id, { signal: opts.signal }),
      (ev) => SETTLED.includes(ev.status),
      { ...opts, describe: `evaluation ${id}`, statusOf: (ev) => ev.status },
    );
  }

  /** Submit and wait. What most callers want. */
  async createAndWait(
    params: EvaluationCreateParams,
    opts: PollOptions = {},
  ): Promise<Evaluation> {
    const queued = await this.create(params, { signal: opts.signal });
    if (SETTLED.includes(queued.status)) return queued;
    return this.waitUntilSettled(queued.id, opts);
  }
}

/**
 * How many evaluations the census covers, restricted to the statuses asked for.
 *
 * `counts` ignores `status` by design: one census answers both "how much is
 * there in total" and "how many pages does this filter have", and the second
 * question is this function.
 *
 * A status the census does not mention contributes 0 rather than being an error
 * — a deployment that adds a status this client has not heard of should not
 * break paging in a client that is not asking for it.
 */
function countFor(counts: Record<string, number>, status?: EvaluationStatus[]): number {
  const keys = status?.length ? status : Object.keys(counts);
  return keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}
