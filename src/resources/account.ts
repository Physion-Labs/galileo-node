/** Who you are, what you may run, what it costs, and whether we are up. */

import type { Transport } from "../internal/transport.js";
import type { RequestOptions } from "../internal/options.js";
import type { Account, Credits, ModelList, QuotaReport, SystemStatus } from "../types.js";

export class AccountResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Your account. Also the cheapest way to check that a key works — it needs no
   * video, spends no credits, and fails with `AuthenticationError` if the key is
   * wrong.
   */
  async retrieve(opts: RequestOptions = {}): Promise<Account> {
    return this.transport.json<Account>({ method: "GET", path: "/v1/me", signal: opts.signal });
  }

  /** Models and the concrete builds behind them. */
  async models(opts: RequestOptions = {}): Promise<ModelList> {
    return this.transport.json<ModelList>({ method: "GET", path: "/v1/models", signal: opts.signal });
  }

  /** Where each rate-limit window currently stands. */
  async quota(opts: RequestOptions = {}): Promise<QuotaReport> {
    return this.transport.json<QuotaReport>({ method: "GET", path: "/v1/quota", signal: opts.signal });
  }

  /** Balance and the rate card evaluations are priced against. */
  async credits(opts: RequestOptions = {}): Promise<Credits> {
    return this.transport.json<Credits>({ method: "GET", path: "/v1/credits", signal: opts.signal });
  }

  /**
   * Platform health. The one endpoint that needs no key, so it still answers
   * when the problem is your credentials.
   */
  async status(opts: RequestOptions = {}): Promise<SystemStatus> {
    return this.transport.json<SystemStatus>({
      method: "GET",
      path: "/v1/status",
      anonymous: true,
      signal: opts.signal,
    });
  }
}
