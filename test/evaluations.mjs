import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client, InvalidRequestError, PollTimeoutError, ServerError } from "../dist/index.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const ev = (status = "completed") => ({ id: "eval_1", model: "galileo-1.0", status, result: null });
const video = (status = "ready") => ({ id: "vid_1", status, cdn_url: "https://cdn.example/clip.mp4" });
const reservation = (extra = {}) => json({ video_id: "vid_1", upload_path: "/put", ...extra });
const remote = { model: "galileo-1.0", input: { video: { url: "https://example.com/video.mp4" } } };
let dir, clip;
const bytes = Buffer.from("test video bytes");
test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "client-evaluation-"));
  clip = join(dir, "video.mp4");
  await writeFile(clip, bytes);
});
test.after(async () => rm(dir, { recursive: true, force: true }));

function script(...responses) {
  const calls = [];
  const client = new Client({
    apiKey: "test", baseURL: "https://api.example", uploadBaseURL: "https://storage.example",
    fetch: async (url, init) => {
      const body = init.body instanceof ReadableStream ? await new Response(init.body).arrayBuffer() : init.body;
      calls.push({ url, ...init, body });
      assert.ok(responses.length, `Unexpected call to ${url}`);
      return responses.shift();
    },
  });
  return { client, calls };
}

test("create uploads, validates, submits and polls, without exposing the key to storage", async () => {
  const { client, calls } = script(reservation(), json({}), json(video("processing")),
    json(video()), json(ev("queued")), json(ev()));
  const params = { model: "galileo-1.0", input: { video: { path: clip }, prompt: "A ball rolls." } };
  const result = await client.evaluations.create(params);
  assert.equal(result.status, "completed");
  assert.deepEqual(calls.map(c => [c.method, new URL(c.url).pathname]), [
    ["POST", "/v1/videos"], ["PUT", "/put"], ["POST", "/v1/videos/vid_1/complete"],
    ["GET", "/v1/videos/vid_1"], ["POST", "/v1/evaluations"], ["GET", "/v1/evaluations/eval_1"],
  ]);
  assert.deepEqual(Buffer.from(calls[1].body), bytes);
  assert.equal(calls[1].headers.authorization, undefined);
  assert.deepEqual(JSON.parse(calls[4].body), {
    model: "galileo-1.0", input: { video: { upload_id: "vid_1" }, prompt: "A ball rolls." },
  });
  assert.deepEqual(params.input.video, { path: clip });
});

for (const method of ["create", "submit"]) {
  test(`${method} never submits a rejected video`, async () => {
    const { client, calls } = script(reservation(), json({}), json(video("failed")));
    await assert.rejects(client.evaluations[method]({ model: "galileo-1.0", input: { video: { path: clip } } }),
      InvalidRequestError);
    assert.equal(calls.length, 3);
  });
  test(`${method} does not repeat an ambiguous submission`, async () => {
    const { client, calls } = script(json({ error: { code: "internal_error", message: "failed" } }, 500));
    await assert.rejects(client.evaluations[method](remote), ServerError);
    assert.equal(calls.length, 1);
  });
}

test("submit reuses a processing upload, waits for validation, then returns the queued ID", async () => {
  const { client, calls } = script(reservation({ skip_upload: true }), json(video("processing")),
    json(video()), json(ev("queued")));
  const result = await client.evaluations.submit({ model: "galileo-1.0", input: { video: { path: clip } } });
  assert.equal(result.status, "queued");
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.method !== "PUT"));
});

for (const source of [{ url: "https://example.com/v.mp4" }, { upload_id: "vid_1" }, { b64_json: "dmlkZW8=" }]) {
  test(`submit ${Object.keys(source)[0]} makes only the submission request`, async () => {
    const { client, calls } = script(json(ev("queued")));
    const result = await client.evaluations.submit({ model: "galileo-1.0", input: { video: source }, metadata: { job: 1 } });
    assert.equal(result.status, "queued");
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].body), { model: "galileo-1.0", input: { video: source }, metadata: { job: 1 } });
  });
}

for (const status of ["completed", "partial", "failed"]) {
  test(`create returns terminal status ${status}`, async () => {
    const { client, calls } = script(json(ev("queued")), json(ev(status)));
    assert.equal((await client.evaluations.create(remote)).status, status);
    assert.equal(calls.length, 2);
  });
}

test("a poll timeout names the existing ID and does not submit again", async () => {
  const { client, calls } = script(json(ev("queued")), json(ev("processing")));
  await assert.rejects(client.evaluations.create(remote, { timeoutMs: 0 }),
    error => error instanceof PollTimeoutError && error.message.includes("eval_1"));
  assert.equal(calls.filter(c => c.method === "POST").length, 1);
});

test("abort stops polling after submission", async () => {
  const { client, calls } = script(json(ev("queued")));
  const controller = new AbortController();
  const original = client.evaluations.submit.bind(client.evaluations);
  client.evaluations.submit = async (...args) => {
    const result = await original(...args);
    controller.abort();
    return result;
  };
  await assert.rejects(client.evaluations.create(remote, { signal: controller.signal }));
  assert.equal(calls.length, 1);
});

for (const input of [{}, { video: { path: "x", url: "https://example.com/x" } },
  { video: { url: "" } }, { video: { url: 1 } }, { video: { path: "x" }, prompt: 3 },
  { video: { path: "x" }, typo: true }]) {
  test(`invalid input is rejected before upload: ${JSON.stringify(input)}`, async () => {
    const { client, calls } = script();
    await assert.rejects(client.evaluations.create({ model: "galileo-1.0", input }), TypeError);
    assert.equal(calls.length, 0);
  });
}
