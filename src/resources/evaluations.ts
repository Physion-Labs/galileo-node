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
    });
  }

  async retrieve(id: string, opts: RequestOptions = {}): Promise<Evaluation> {
    return this.transport.json<Evaluation>({
      method: "GET",
      path: `/v1/evaluations/${encodeURIComponent(id)}`,
      signal: opts.signal,
    });
  }

  /** Your evaluations, newest first. */
  async list(
    params: { limit?: number; video_id?: string } = {},
    opts: RequestOptions = {},
  ): Promise<EvaluationList> {
    return this.transport.json<EvaluationList>({
      method: "GET",
      path: "/v1/evaluations",
      query: { limit: params.limit, video_id: params.video_id },
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
