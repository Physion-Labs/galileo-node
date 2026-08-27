/**
 * What the transport does when the API says no.
 *
 * Every test here drives a fake `fetch`, so nothing reaches the network and the
 * number of attempts is observable — which is the whole thing being asserted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Galileo, { RateLimitError, ServerError, InsufficientCreditsError } from "../dist/index.js";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** A fetch that answers from a script, and records what it was asked. */
function scripted(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`fetch called ${calls.length} times; script had fewer`);
    return typeof next === "function" ? next() : next;
  };
  return { fetch, calls };
}

const client = (fetch, opts = {}) =>
  new Galileo({ apiKey: "gk_live_test", baseURL: "https://api.example", fetch, ...opts });

test("the key travels as a bearer token", async () => {
  const { fetch, calls } = scripted(json(200, { object: "user", credits: 1 }));
  await client(fetch).account.retrieve();
  assert.equal(calls[0].init.headers.authorization, "Bearer gk_live_test");
});

test("/v1/status carries no key, so it still answers when the key is the problem", async () => {
  const { fetch, calls } = scripted(json(200, { state: "ok" }));
  await client(fetch).account.status();
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("a 500 is retried", async () => {
  const { fetch, calls } = scripted(
    json(500, { error: { type: "api_error", code: "internal", message: "boom" } }),
    json(200, { object: "user", credits: 1 }),
  );
  await client(fetch, { maxRetries: 2 }).account.retrieve();
  assert.equal(calls.length, 2);
});

test("a 500 that keeps failing is thrown, not retried forever", async () => {
  const { fetch, calls } = scripted(
    ...Array.from({ length: 3 }, () =>
      json(500, { error: { type: "api_error", code: "internal", message: "boom" } }),
    ),
  );
  await assert.rejects(() => client(fetch, { maxRetries: 2 }).account.retrieve(), ServerError);
  assert.equal(calls.length, 3, "one attempt plus two retries");
});

test("a model that answered unusably is NOT retried — the same input decodes the same", async () => {
  const { fetch, calls } = scripted(
    json(502, {
      error: { type: "api_error", code: "model_output_invalid", message: "unreadable" },
    }),
  );
  await assert.rejects(
    () => client(fetch, { maxRetries: 3 }).evaluations.create({ video: { url: "https://x/y.mp4" } }),
    ServerError,
  );
  assert.equal(calls.length, 1, "retrying would spend credits again on a decided failure");
});

test("a 402 is not retried: the balance has to change, and waiting will not change it", async () => {
  const { fetch, calls } = scripted(
    json(402, { error: { type: "invalid_request_error", code: "insufficient_credits", message: "broke" } }),
  );
  await assert.rejects(
    () => client(fetch, { maxRetries: 3 }).evaluations.create({ video: { url: "https://x/y.mp4" } }),
    InsufficientCreditsError,
  );
  assert.equal(calls.length, 1);
});

test("a 429 is waited out, and the wait is not charged to the retry count", async () => {
  const { fetch, calls } = scripted(
    json(429, { error: { type: "rate_limit_error", code: "rate_limited", message: "slow down" } }, { "retry-after": "0" }),
    json(429, { error: { type: "rate_limit_error", code: "rate_limited", message: "slow down" } }, { "retry-after": "0" }),
    json(429, { error: { type: "rate_limit_error", code: "rate_limited", message: "slow down" } }, { "retry-after": "0" }),
    json(201, { id: "eval_1", status: "queued" }),
  );
  // maxRetries is 0: were rate limiting charged to it, the first 429 would throw.
  const ev = await client(fetch, { maxRetries: 0 }).evaluations.create({ video: { url: "https://x/y.mp4" } });
  assert.equal(ev.id, "eval_1");
  assert.equal(calls.length, 4);
});

test("a 429 past the budget throws, and says how long the server asked for", async () => {
  const { fetch } = scripted(
    json(429, { error: { type: "rate_limit_error", code: "rate_limited", message: "slow down" } }, { "retry-after": "30" }),
  );
  await assert.rejects(
    () => client(fetch, { rateLimitBudgetMs: 1_000 }).account.retrieve(),
    (err) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.retryAfterMs, 30_000);
      return true;
    },
  );
});

test("a non-JSON error body still produces a typed error", async () => {
  const { fetch } = scripted(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
  await assert.rejects(
    () => client(fetch, { maxRetries: 0 }).account.retrieve(),
    (err) => {
      assert.ok(err instanceof ServerError);
      assert.equal(err.status, 502);
      assert.match(err.message, /502/);
      return true;
    },
  );
});

test("concurrency is bounded, so a wide Promise.all does not open every socket at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const fetch = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return json(200, { object: "user", credits: 1 });
  };
  const galileo = client(fetch, { maxConcurrency: 2 });
  await Promise.all(Array.from({ length: 10 }, () => galileo.account.retrieve()));
  assert.equal(peak, 2, `peak in flight was ${peak}`);
});
