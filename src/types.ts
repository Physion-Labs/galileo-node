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
/**
 * What you may send to create a run.
 *
 * NOT `Schemas["EvaluationCreate"]` directly. A property carrying a `default` in
 * the contract is one the caller MAY OMIT -- the server supplies the value --
 * but openapi-typescript types a defaulted property as required. That is right
 * for a response, where the default has already been applied by the time you
 * read it, and wrong for a request body, where the default is the entire reason
 * you can leave the field out.
 *
 * rc.3 shipped this way, so `glitch_types` was mandatory and the one-line
 * example in our own README, quickstart and docs did not compile. Nothing
 * failed: the contract check passes (the generated file IS what the contract
 * generates), `tsc --noEmit` passes (no sample is compiled), and the packaging
 * tests pass. It took compiling the documented examples against the published
 * tarball to see it.
 *
 * Listed explicitly rather than blanket-`Partial`, so a field the contract
 * really does require stays required. `test/types.mjs` derives the same set from
 * the yaml and fails if this list drifts from it — which is how `prompt` left
 * this list: PHY-93 made a prompt mandatory on every run, so the contract now
 * requires it and it carries no default. The test said so before a human did.
 */
type DefaultedByServer = "glitch_types";

export type EvaluationCreateParams = Omit<Schemas["EvaluationCreate"], DefaultedByServer> &
  Partial<Pick<Schemas["EvaluationCreate"], DefaultedByServer>>;
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
