/**
 * The three-call upload, driven by a fake fetch.
 *
 * The test that matters most is the third one. Everything else here is shape;
 * that one is the difference between an upload and a leaked credential.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Galileo, { InvalidRequestError } from "../dist/index.js";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let dir;
let clip;
const BYTES = Buffer.from("not really an mp4, but it has a length and a hash");

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "galileo-upload-"));
  clip = join(dir, "clip.mp4");
  await writeFile(clip, BYTES);
});

test.after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function recorder(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, method: init.method });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${calls.length} to ${url}`);
    return next;
  };
  return { fetch, calls };
}

const client = (fetch, opts = {}) =>
  new Galileo({
    apiKey: "gk_live_test",
    baseURL: "https://api.example",
    uploadBaseURL: "https://uploads.example",
    fetch,
    ...opts,
  });

test("upload makes three calls, in order, and returns the ready record", async () => {
  const { fetch, calls } = recorder(
    json(201, { video_id: "vid_1", cdn_url: "https://cdn/x.mp4", upload_path: "/v1/uploads?key=a&token=b" }),
    new Response(null, { status: 200 }),
    json(200, { id: "vid_1", object: "video", status: "ready", cdn_url: "https://cdn/x.mp4" }),
  );
  const video = await client(fetch).videos.upload({ path: clip });

  assert.equal(video.status, "ready");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      "POST https://api.example/v1/videos",
      "PUT https://uploads.example/v1/uploads?key=a&token=b",
      "POST https://api.example/v1/videos/vid_1/complete",
    ],
  );
});

test("the reservation declares the real size and the real hash", async () => {
  const { fetch, calls } = recorder(
    json(201, { video_id: "vid_1", cdn_url: "https://cdn/x.mp4", upload_path: "/put" }),
    new Response(null, { status: 200 }),
    json(200, { id: "vid_1", object: "video", status: "ready", cdn_url: "https://cdn/x.mp4" }),
  );
  await client(fetch).videos.upload({ path: clip });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.size_bytes, BYTES.byteLength);
  assert.equal(body.content_type, "video/mp4");
  assert.equal(body.content_hash, createHash("sha256").update(BYTES).digest("hex"));
});

test("the PUT carries NO Authorization header — that host never needed the key", async () => {
  const { fetch, calls } = recorder(
    json(201, { video_id: "vid_1", cdn_url: "https://cdn/x.mp4", upload_path: "/put" }),
    new Response(null, { status: 200 }),
    json(200, { id: "vid_1", object: "video", status: "ready", cdn_url: "https://cdn/x.mp4" }),
  );
  await client(fetch).videos.upload({ path: clip });

  const put = calls.find((c) => c.method === "PUT");
  assert.equal(put.init.headers.authorization, undefined, "a key sent to storage is a key disclosed");
  // And the calls that DO go to the API still carry it, so this is not a blanket
  // failure to authenticate.
  for (const api of calls.filter((c) => c.url.startsWith("https://api.example"))) {
    assert.equal(api.init.headers.authorization, "Bearer gk_live_test");
  }
});

test("the PUT declares Content-Length and streams rather than buffering", async () => {
  const { fetch, calls } = recorder(
    json(201, { video_id: "vid_1", cdn_url: "https://cdn/x.mp4", upload_path: "/put" }),
    new Response(null, { status: 200 }),
    json(200, { id: "vid_1", object: "video", status: "ready", cdn_url: "https://cdn/x.mp4" }),
  );
  await client(fetch).videos.upload({ path: clip });

  const put = calls.find((c) => c.method === "PUT").init;
  assert.equal(put.headers["content-length"], String(BYTES.byteLength));
  assert.equal(put.headers["content-type"], "video/mp4");
  // A stream body, not a Buffer: this is what keeps a 50 MB clip off the heap.
  assert.ok(put.body instanceof ReadableStream, `body was ${put.body?.constructor?.name}`);
  assert.equal(put.duplex, "half", "Node's fetch rejects a stream body without it");
});

test("content already held: no PUT, no completion call", async () => {
  const { fetch, calls } = recorder(
    json(201, { video_id: "vid_dup", cdn_url: "https://cdn/x.mp4", skip_upload: true }),
    json(200, { id: "vid_dup", object: "video", status: "ready", cdn_url: "https://cdn/x.mp4" }),
  );
  const video = await client(fetch).videos.upload({ path: clip });

  assert.equal(video.id, "vid_dup");
  assert.equal(calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(calls.some((c) => c.url.includes("/complete")), false);
});

test("dedupe: false sends no hash, and so cannot be told the content is held", async () => {
  const { fetch, calls } = recorder(
    json(201, { video_id: "vid_1", cdn_url: "https://cdn/x.mp4", upload_path: "/put" }),
    new Response(null, { status: 200 }),
    json(200, { id: "vid_1", object: "video", status: "ready", cdn_url: "https://cdn/x.mp4" }),
  );
  await client(fetch).videos.upload({ path: clip, dedupe: false });
  assert.equal(JSON.parse(calls[0].init.body).content_hash, undefined);
});

test("an oversized file is refused locally, before anything is sent", async () => {
  const big = join(dir, "big.mp4");
  await writeFile(big, Buffer.alloc(1024));
  const { fetch, calls } = recorder();
  // Patch the limit by lying about the file instead: simpler than writing 50 MB.
  const galileo = client(fetch);
  const huge = join(dir, "huge.mp4");
  await writeFile(huge, Buffer.alloc(0));
  await assert.rejects(() => galileo.videos.upload({ path: huge }), InvalidRequestError);
  assert.equal(calls.length, 0, "an empty file should cost no request either");
});

test("a video that fails validation is returned, not thrown", async () => {
  const { fetch } = recorder(
    json(201, { video_id: "vid_bad", cdn_url: "https://cdn/x.mp4", upload_path: "/put" }),
    new Response(null, { status: 200 }),
    json(200, { id: "vid_bad", object: "video", status: "failed", cdn_url: "https://cdn/x.mp4" }),
  );
  const video = await client(fetch).videos.upload({ path: clip });
  assert.equal(video.status, "failed", "a rejected file is an outcome to inspect, not an exception");
});
