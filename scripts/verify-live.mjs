/**
 * Does the running service actually answer the way the contract says?
 *
 * The premise of a frozen contract is that two SDKs can be built against it
 * without either drifting from the server. Nothing in that premise holds unless
 * something checks the contract against a real response — otherwise the document
 * is a description of what somebody once believed.
 *
 * So this is not a test of the client. It is a test of the CONTRACT, using the
 * client as a way to make the calls. It validates with a real JSON Schema
 * validator rather than by comparing key lists, because the first version of this
 * check did the latter and produced a false alarm within minutes: `QuotaReport`
 * composes with `allOf`, a hand-rolled key comparison saw no declared properties,
 * and every field looked undocumented. Composition, nullability and formats are
 * exactly the parts worth checking and exactly the parts eyeballing gets wrong.
 *
 *   GALILEO_API_KEY=gk_... node scripts/verify-live.mjs
 *   GALILEO_BASE_URL=https://api.physionlabs.ai ... (defaults to the dev deployment)
 *
 * OpenAPI 3.1 schemas ARE JSON Schema 2020-12, so no translation step is needed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const doc = parse(readFileSync(join(root, "openapi", "galileo-v1.yaml"), "utf8"));

const BASE_URL = process.env.GALILEO_BASE_URL ?? "https://api-dev.physionlabs.ai";
const API_KEY = process.env.GALILEO_API_KEY;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
// Registered whole, so `$ref: "#/components/schemas/X"` resolves the same way it
// does inside the document. Compiling each schema in isolation would break every
// cross-reference, which is most of them.
ajv.addSchema(doc, "contract");

/**
 * Validate, and report ROOT CAUSES rather than every consequence.
 *
 * A nullable `$ref` is a two-branch `anyOf`, so one bad field inside the object
 * branch produces three errors: the real one, "must be null" from the branch that
 * was never going to match, and the umbrella "must match a schema in anyOf". The
 * first run of this script printed all three for every offending box and the
 * actual defect was hard to find in its own cascade.
 *
 * So: drop a composition error whenever a more specific error exists beneath its
 * path, and drop the null-branch complaint when the value plainly is not null.
 */
function validate(schemaName, value) {
  const check = ajv.compile({ $ref: `contract#/components/schemas/${schemaName}` });
  if (check(value)) return null;

  const raw = check.errors.map((e) => ({
    path: e.instancePath || "$",
    message: e.message,
    keyword: e.keyword,
    extra: e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : "",
  }));
  const deeper = (p) => raw.some((o) => o.path.length > p.length && o.path.startsWith(p));
  const kept = raw.filter((o) => {
    if ((o.keyword === "anyOf" || o.keyword === "oneOf") && deeper(o.path)) return false;
    if (o.keyword === "type" && o.message === "must be null" && deeper(o.path)) return false;
    return true;
  });
  const seen = new Set();
  return kept
    .map((o) => `${o.path} ${o.message}${o.extra}`)
    .filter((line) => !seen.has(line) && seen.add(line));
}

async function get(path, { auth = true } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: auth ? { authorization: `Bearer ${API_KEY}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

const cases = [
  { path: "/v1/status", schema: "SystemStatus", auth: false },
  { path: "/v1/me", schema: "Account" },
  { path: "/v1/models", schema: "ModelList" },
  { path: "/v1/quota", schema: "QuotaReport" },
  { path: "/v1/credits", schema: "Credits" },
  { path: "/v1/evaluations?limit=5", schema: "EvaluationList" },
];

console.log(`Contract: openapi/galileo-v1.yaml\nAgainst:  ${BASE_URL}\n`);

let failures = 0;
let skipped = 0;
for (const c of cases) {
  if (c.auth !== false && !API_KEY) {
    console.log(`  ~ ${c.path}  SKIPPED (no GALILEO_API_KEY)`);
    skipped++;
    continue;
  }
  let body;
  try {
    body = await get(c.path, { auth: c.auth !== false });
  } catch (e) {
    console.log(`  ✗ ${c.path}  ${e.message}`);
    failures++;
    continue;
  }
  const errors = validate(c.schema, body);
  if (errors) {
    failures++;
    console.log(`  ✗ ${c.path}  (${c.schema})`);
    for (const e of errors.slice(0, 12)) console.log(`      ${e}`);
    if (errors.length > 12) console.log(`      … and ${errors.length - 12} more`);
  } else {
    console.log(`  ✓ ${c.path}  (${c.schema})`);
  }
}

// The list endpoint carries whole evaluations, so it is also the cheapest way to
// validate `Evaluation` — including a completed one, which the schema's
// interesting half describes.
if (API_KEY) {
  try {
    const list = await get("/v1/evaluations?limit=20");
    const settled = list.data.filter((e) => ["completed", "partial", "failed"].includes(e.status));
    console.log(`\n  ${list.data.length} evaluation(s) in the list, ${settled.length} settled`);
    for (const ev of settled.slice(0, 5)) {
      const errors = validate("Evaluation", ev);
      if (errors) {
        failures++;
        console.log(`  ✗ evaluation ${ev.id} (${ev.status})`);
        for (const e of errors.slice(0, 12)) console.log(`      ${e}`);
      } else {
        console.log(`  ✓ evaluation ${ev.id} (${ev.status})`);
      }
    }
  } catch (e) {
    console.log(`  ! could not sample evaluations: ${e.message}`);
  }
}

// A check that says "verified" when it verified almost nothing is worse than no
// check: it turns an unverified contract into a green tick. Only ONE of these
// cases needs no credential, so without a key this script has looked at the
// simplest endpoint in the API and nothing else.
if (failures) {
  console.log(`\n${failures} mismatch(es).`);
  process.exit(1);
}
if (skipped) {
  console.log(
    `\nINCOMPLETE — ${cases.length - skipped} of ${cases.length} endpoints checked, ${skipped} skipped ` +
      `for want of GALILEO_API_KEY.\nThe endpoints that carry the interesting half of the contract ` +
      `(evaluations, models, quota) were NOT verified.`,
  );
  process.exit(2);
}
console.log("\nThe contract matches the live service.");
