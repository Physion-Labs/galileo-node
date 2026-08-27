/**
 * The client.
 *
 * One object, three resources, no configuration required beyond a key.
 */

import { Transport, type FetchLike } from "./internal/transport.js";
import { Evaluations } from "./resources/evaluations.js";
import { Videos } from "./resources/videos.js";
import { AccountResource } from "./resources/account.js";

const DEFAULT_BASE_URL = "https://api.physionlabs.ai";

export interface GalileoOptions {
  /**
   * Your API key. Defaults to `process.env.GALILEO_API_KEY`.
   *
   * Read from the environment rather than required as an argument because the
   * alternative is a key written into a source file, and a key written into a
   * source file is a key in somebody's git history.
   */
  apiKey?: string;
  /** Override the API root. Point this at a development deployment. */
  baseURL?: string;
  /**
   * Where a relative upload path is rooted. Defaults to `baseURL`.
   *
   * Separate because the two genuinely differ: uploads go to storage
   * infrastructure, and pinning them together would send a request to whichever
   * host happens to serve the API.
   */
  uploadBaseURL?: string;
  /** Per-attempt deadline, ms. Default 60000. */
  timeoutMs?: number;
  /** Attempts after the first, for failures that might not repeat. Default 2. */
  maxRetries?: number;
  /** Total time to spend waiting out rate limits, per request. Default 60000. */
  rateLimitBudgetMs?: number;
  /** Requests in flight at once. Default 4. */
  maxConcurrency?: number;
  /** Override for tests, or an unusual runtime. */
  fetch?: FetchLike;
}

export class Galileo {
  readonly evaluations: Evaluations;
  readonly videos: Videos;
  readonly account: AccountResource;

  constructor(opts: GalileoOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GALILEO_API_KEY;
    if (!apiKey) {
      throw new Error(
        "No API key. Pass `apiKey`, or set GALILEO_API_KEY in the environment.",
      );
    }
    const baseURL = opts.baseURL ?? DEFAULT_BASE_URL;

    const transport = new Transport({
      apiKey,
      baseURL,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      ...(opts.rateLimitBudgetMs !== undefined ? { rateLimitBudgetMs: opts.rateLimitBudgetMs } : {}),
      ...(opts.maxConcurrency !== undefined ? { maxConcurrency: opts.maxConcurrency } : {}),
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });

    this.evaluations = new Evaluations(transport);
    this.videos = new Videos(transport, opts.uploadBaseURL ?? baseURL);
    this.account = new AccountResource(transport);
  }
}
