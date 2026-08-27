/**
 * @physionlabs/galileo — Node client for the Galileo video evaluation API.
 *
 * Note what is NOT exported: `internal/contract.d.ts`. It is generated from the
 * OpenAPI description and its shape (`paths`, `operations`, deep index types) is
 * an artefact of the generator, not an API. Everything worth naming is
 * re-exported from `types.ts` under a name a caller should see.
 */

export { Galileo, type GalileoOptions } from "./client.js";
export { Galileo as default } from "./client.js";

export type { UploadParams } from "./resources/videos.js";
export type { PollOptions } from "./internal/poll.js";
export type { RequestOptions } from "./internal/options.js";
export type { FetchLike } from "./internal/transport.js";

export {
  GalileoError,
  InvalidRequestError,
  AuthenticationError,
  NotFoundError,
  InsufficientCreditsError,
  RateLimitError,
  ServerError,
  ConnectionError,
  TimeoutError,
} from "./errors.js";

export type * from "./types.js";
