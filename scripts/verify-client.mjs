// Explicit release smoke test: runs two evaluations against the selected deployment.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "../dist/index.js";

assert.ok(process.env.GALILEO_API_KEY, "GALILEO_API_KEY is required");
assert.ok(process.env.GALILEO_TEST_VIDEO_URL, "GALILEO_TEST_VIDEO_URL is required");
const client = new Client({ baseURL: process.env.GALILEO_BASE_URL });
const local = await client.evaluations.create({
  model: "galileo-1.0",
  input: { video: { path: fileURLToPath(new URL("../test/fixtures/release.mp4", import.meta.url)) } },
});
assert.equal(local.status, "completed", local.error?.message);
assert.ok(local.result);
console.log("Local file → automatic upload → create:", local.id, local.status);

const job = await client.evaluations.submit({
  model: "galileo-1.0",
  input: {
    video: { url: process.env.GALILEO_TEST_VIDEO_URL },
    prompt: "A red background fills the frame.",
  },
});
assert.ok(job.id);
const current = await client.evaluations.retrieve(job.id);
assert.equal(current.id, job.id);
console.log("URL + prompt → submit → retrieve:", current.id, current.status);
const result = await client.evaluations.waitUntilSettled(job.id);
assert.equal(result.status, "completed", result.error?.message);
assert.ok(result.result);
console.log("Wait for submitted evaluation:", result.id, result.status);
