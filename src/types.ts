/** Public response types come from OpenAPI. SDK request types additionally
 * accept local paths, which are uploaded before the HTTP request is sent. */

import type { components } from "./internal/contract.js";

type Schemas = components["schemas"];

// --- Evaluations -----------------------------------------------------------

export type Evaluation = Schemas["Evaluation"];
/** Legacy HTTP body, retained for the Galileo compatibility entry point. */
export type LegacyEvaluationCreateParams = Schemas["LegacyEvaluationCreate"];

/** SDK inputs add a local path; the SDK replaces it with an upload_id. */
type VideoSource = Schemas["VideoRef"] | { path: string };
type ExclusiveVideo<T = VideoSource> = T extends unknown
  ? T & Partial<Record<Exclude<"path" | "url" | "upload_id" | "b64_json", keyof T>, never>>
  : never;
export type VideoInput = ExclusiveVideo;
export type EvaluationInput = Omit<Schemas["EvaluationRequestInput"], "video"> & { video: VideoInput };
export type EvaluationCreateParams = Omit<Schemas["EvaluationCreate"], "input"> & {
  input: EvaluationInput;
};
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

export type Timing = Schemas["Timing"];

// --- Findings --------------------------------------------------------------

/**
 * One finding — a union discriminated on `type`, not one object with everything
 * on it.
 *
 * The two kinds genuinely carry different fields: a visual glitch has a `region`
 * in the clip, a prompt misalignment has the `prompt_segment` of your prompt and
 * a `severity`. Narrowing on `type` gives you exactly the fields that apply:
 *
 *     if (finding.type === "prompt_misalignment") finding.severity;
 *     else finding.region;
 *
 * Before this the two were one type with every field optional, so `severity` was
 * reachable on a visual glitch, where it never appears.
 */
export type Glitch = Schemas["Glitch"];
export type VisualGlitch = Schemas["VisualGlitch"];
export type PromptMisalignment = Schemas["PromptMisalignment"];
export type GlitchType = Schemas["GlitchType"];
export type GlitchSource = Schemas["GlitchSource"];
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
