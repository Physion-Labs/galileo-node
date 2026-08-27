/**
 * Against a real deployment.
 *
 * Split in two on purpose. The unauthenticated half runs on every `pnpm test`,
 * because `/v1/status` needs no key and a contract that has never been compared
 * to a live response is a document, not a description. The authenticated half is
 * skipped unless `GALILEO_API_KEY` is set — CI has no key, and a suite that
 * fails for want of a credential teaches people to ignore it.
 *
 * DEFAULTS TO THE DEVELOPMENT DEPLOYMENT, and that is deliberate. An evaluation
 * costs credits and a video occupies storage; neither belongs in a production
 * account because somebody ran the test suite. Point it elsewhere explicitly:
 *
 *   GALILEO_BASE_URL=https://api.physionlabs.ai GALILEO_API_KEY=gk_... pnpm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import Galileo, { AuthenticationError } from "../dist/index.js";

const BASE_URL = process.env.GALILEO_BASE_URL ?? "https://api-dev.physionlabs.ai";
const API_KEY = process.env.GALILEO_API_KEY;
const VIDEO_URL = process.env.GALILEO_TEST_VIDEO_URL;

// --- no key required ------------------------------------------------------

test("the live deployment answers /v1/status in the shape the contract describes", async () => {
  const galileo = new Galileo({ apiKey: "gk_unused_for_status", baseURL: BASE_URL });
  const status = await galileo.account.status();

  assert.ok(["operational", "degraded", "outage"].includes(status.state), `state was ${status.state}`);
  assert.equal(typeof status.checked_at, "number");
  assert.ok(Array.isArray(status.components) && status.components.length > 0);
  for (const c of status.components) {
    for (const field of ["key", "name", "description", "state", "detail"]) {
      assert.equal(typeof c[field], "string", `component.${field}`);
    }
  }
});

test("a bad key is an AuthenticationError, not a hang or a generic 500", async () => {
  const galileo = new Galileo({ apiKey: "gk_live_definitely_not_valid", baseURL: BASE_URL });
  await assert.rejects(() => galileo.account.retrieve(), AuthenticationError);
});

// --- key required ---------------------------------------------------------

const authed = { skip: API_KEY ? false : "set GALILEO_API_KEY to run" };

test("the key identifies an account", authed, async () => {
  const galileo = new Galileo({ apiKey: API_KEY, baseURL: BASE_URL });
  const me = await galileo.account.retrieve();
  assert.equal(me.object, "user");
  assert.equal(typeof me.tier, "string");
  assert.equal(typeof me.credits, "number");
});

test("models, quota and credits all answer", authed, async () => {
  const galileo = new Galileo({ apiKey: API_KEY, baseURL: BASE_URL });
  const [models, quota, credits] = await Promise.all([
    galileo.account.models(),
    galileo.account.quota(),
    galileo.account.credits(),
  ]);
  assert.ok(models.data.length > 0, "the catalogue is empty");
  assert.ok(models.data.some((m) => m.id === "galileo"));
  assert.ok(quota);
  assert.equal(typeof credits.credits, "number");
});

test("listing evaluations returns a list object", authed, async () => {
  const galileo = new Galileo({ apiKey: API_KEY, baseURL: BASE_URL });
  const page = await galileo.evaluations.list({ limit: 3 });
  assert.equal(page.object, "list");
  assert.ok(Array.isArray(page.data));
  assert.ok(page.data.length <= 3);
});

/**
 * The whole point of the client, and the only test that spends anything.
 *
 * Gated on its own variable rather than on the key, so `GALILEO_API_KEY` alone
 * exercises everything that is free and a run that costs credits is always a
 * deliberate act.
 */
const billed = {
  skip: API_KEY && VIDEO_URL ? false : "set GALILEO_API_KEY and GALILEO_TEST_VIDEO_URL to run",
};

test("submit a video and read back what Galileo found", billed, async () => {
  const galileo = new Galileo({ apiKey: API_KEY, baseURL: BASE_URL });
  const evaluation = await galileo.evaluations.createAndWait(
    {
      prompt: "A red ball rolls off a table and bounces twice.",
      video: { url: VIDEO_URL },
    },
    { timeoutMs: 300_000 },
  );

  assert.ok(["completed", "partial", "failed"].includes(evaluation.status));
  assert.equal(evaluation.object, "evaluation");
  assert.equal(typeof evaluation.model_version, "string");

  if (evaluation.status === "failed") {
    assert.ok(evaluation.error, "a failed evaluation must say why");
    return;
  }

  assert.ok(evaluation.result, "a settled non-failed evaluation must carry a result");
  const { glitches, summary } = evaluation.result;
  assert.equal(summary.num_glitches, glitches.length, "the summary must count the list it is shown beside");

  for (const g of glitches) {
    assert.equal(typeof g.id, "string");
    assert.ok(["visual_glitch", "prompt_misalignment"].includes(g.type));
    assert.equal(typeof g.description, "string");
    if (g.severity !== undefined) {
      assert.ok(g.severity >= 1 && g.severity <= 5, `severity ${g.severity} out of range`);
    }
  }

  // Fields the contract does not promise. Not an assertion: the server decides
  // what it sends, and this suite's job is to say so out loud rather than to
  // fail on it. `glitch_category` is expected here until it is mapped to a
  // readable name upstream.
  const undocumented = [
    ...new Set(glitches.flatMap((g) => ["confidence", "glitch_category"].filter((k) => k in g))),
  ];
  if (undocumented.length) {
    console.warn(`  ! undocumented fields on the wire: ${undocumented.join(", ")}`);
  }
});
