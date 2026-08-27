/**
 * The API's shapes, as the contract defines them.
 *
 * EVERY TYPE HERE IS AN ALIAS, and that is the whole design. The previous
 * generation of this client hand-wrote these declarations and then used a
 * compile-time assertion to check them against the server's internal types --
 * which worked only while the client and the server lived in the same
 * repository, and worked by coupling a public package to a private one.
 *
 * Here the contract is the source. `openapi/galileo-v1.yaml` generates
 * `internal/contract.d.ts`, and these aliases give its schemas the names a
 * caller should see. So a field cannot be wrong here without being wrong in the
 * contract, and there is no copy to keep in step: `pnpm contract:check` fails if
 * the generated file is not what the contract produces.
 *
 * It has already paid for itself. The contract declared `source` with
 * `default: model`, which every generator reads as "the server always sends
 * this"; the server omits it instead. Generating rather than transcribing turned
 * that into a visible type change instead of a wrong hand-written `?`.
 *
 * What the aliases are allowed to do is RENAME. `EvaluationFailure` is the
 * contract's name for the object on a failed run and reads oddly as a property
 * type, so it is also exported as `EvaluationError`. What they must never do is
 * narrow, widen, or add.
 */

import type { components } from "./internal/contract.js";

type Schemas = components["schemas"];

// --- Evaluations -----------------------------------------------------------

export type Evaluation = Schemas["Evaluation"];
export type EvaluationCreateParams = Schemas["EvaluationCreate"];
export type EvaluationList = Schemas["EvaluationList"];
export type EvaluationResult = Schemas["EvaluationResult"];
export type EvaluationStatus = Schemas["EvaluationStatus"];
export type EvaluationSummary = Schemas["EvaluationSummary"];
export type EvaluationUsage = Schemas["EvaluationUsage"];
/** The contract calls this `EvaluationFailure`; both names are exported. */
export type EvaluationError = Schemas["EvaluationFailure"];
export type EvaluationFailure = Schemas["EvaluationFailure"];

export type DetectorState = Schemas["DetectorState"];
export type DetectorStatus = Schemas["DetectorStatus"];
export type DetectorError = Schemas["DetectorError"];

// --- Findings --------------------------------------------------------------

export type Glitch = Schemas["Glitch"];
export type GlitchType = Schemas["GlitchType"];
export type GlitchRegion = Schemas["GlitchRegion"];
export type PromptSegment = Schemas["PromptSegment"];
export type TimePoint = Schemas["TimePoint"];
export type BoundingBox = Schemas["BoundingBox"];
export type BoxKeyframe = Schemas["BoxKeyframe"];

// --- Videos ----------------------------------------------------------------

export type Video = Schemas["Video"];
export type VideoStatus = Schemas["VideoStatus"];
export type VideoInfo = Schemas["VideoInfo"];
export type VideoReservation = Schemas["VideoReservation"];
export type VideoCreateParams = Schemas["VideoCreate"];

/** How an evaluation names its video: a URL, an uploaded id, or inline bytes. */
export type VideoRef = Schemas["VideoRef"];

// --- Account and platform --------------------------------------------------

export type Account = Schemas["Account"];
export type AccountLimits = Schemas["AccountLimits"];
export type ApiKeySummary = Schemas["ApiKeySummary"];
export type Credits = Schemas["Credits"];
export type PricingRates = Schemas["PricingRates"];
export type QuotaReport = Schemas["QuotaReport"];
export type QuotaScopes = Schemas["QuotaScopes"];
export type RateLimitWindow = Schemas["RateLimitWindow"];
export type RateLimitDefinition = Schemas["RateLimitDefinition"];

export type Model = Schemas["Model"];
export type ModelId = Schemas["ModelId"];
export type ModelBuild = Schemas["ModelBuild"];
export type ModelList = Schemas["ModelList"];

export type SystemStatus = Schemas["SystemStatus"];
export type ComponentStatus = Schemas["ComponentStatus"];
export type ComponentState = Schemas["ComponentState"];

// --- Errors ----------------------------------------------------------------

export type ApiErrorBody = Schemas["Error"];
export type ApiErrorResponse = Schemas["ErrorResponse"];
export type ErrorType = Schemas["ErrorType"];
export type ErrorCode = Schemas["ErrorCode"];
