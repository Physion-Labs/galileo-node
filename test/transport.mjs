/**
 * What the transport does when the API says no.
 *
 * Every test here drives a fake `fetch`, so nothing reaches the network and the
 * number of attempts is observable — which is the whole thing being asserted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Galileo, {
  ConnectionError,
  InsufficientCreditsError,
  RateLimitError,
  ServerError,
} from "../dist/index.js";

const err = (status, code, message = "no", headers = {}) =>
  json(status, { error: { type: "api_error", code, message, request_id: "req_1" } }, headers);

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

test("list sends offset and comma-joins status, which is what the API accepts", async () => {
  const { fetch, calls } = scripted(json(200, { object: "list", data: [], counts: {} }));
  await client(fetch).evaluations.list({ limit: 5, offset: 40, status: ["failed", "partial"] });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("offset"), "40");
  assert.equal(url.searchParams.get("status"), "failed,partial");
});

test("an empty status array is omitted rather than sent as an empty filter", async () => {
  // `?status=` would ask the server to keep nothing, which is the opposite of
  // "no filter" — and a caller building the array from checkboxes hits this.
  const { fetch, calls } = scripted(json(200, { object: "list", data: [], counts: {} }));
  await client(fetch).evaluations.list({ status: [] });
  assert.equal(new URL(calls[0].url).searchParams.has("status"), false);
});

test("iterate pages on counts, not on a short page", async () => {
  // Three of five, then two of five. A short-page test would have stopped after
  // the first page only if it were short — the point is that page one is FULL and
  // is not the end.
  const page = (ids) => json(200, {
    object: "list",
    data: ids.map((id) => ({ id, object: "evaluation", status: "completed" })),
    counts: { completed: 5 },
  });
  const { fetch, calls } = scripted(page(["a", "b", "c"]), page(["d", "e"]));
  const seen = [];
  for await (const ev of client(fetch).evaluations.iterate({ pageSize: 3 })) seen.push(ev.id);
  assert.deepEqual(seen, ["a", "b", "c", "d", "e"]);
  assert.equal(calls.length, 2, "and it stops once counts is reached, without a third request");
  assert.equal(new URL(calls[1].url).searchParams.get("offset"), "3");
});

test("iterate still terminates when the deployment sends no counts", async () => {
  const { fetch, calls } = scripted(
    json(200, { object: "list", data: [{ id: "a", object: "evaluation", status: "completed" }] }),
  );
  const seen = [];
  for await (const ev of client(fetch).evaluations.iterate({ pageSize: 3 })) seen.push(ev.id);
  assert.deepEqual(seen, ["a"]);
  assert.equal(calls.length, 1, "a short page ends it when there is no census to check");
});

test("retry posts to the run's own retry path and returns the successor", async () => {
  const { fetch, calls } = scripted(
    json(201, { id: "eval_2", object: "evaluation", status: "queued", retry_of: "eval_1", attempt: 2 }),
  );
  const next = await client(fetch).evaluations.retry("eval_1");
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /\/v1\/evaluations\/eval_1\/retry$/);
  assert.equal(next.id, "eval_2");
  assert.equal(next.retry_of, "eval_1", "the successor points back at what it replaced");
});

test("retrying something that cannot be retried is an InvalidRequestError", async () => {
  const { fetch } = scripted(
    json(400, {
      error: {
        type: "invalid_request_error",
        code: "invalid_body",
        message: "This run did not fail, so there is nothing to retry.",
      },
    }),
  );
  await assert.rejects(
    () => client(fetch, { maxRetries: 3 }).evaluations.retry("eval_1"),
    (err) => {
      assert.equal(err.name, "InvalidRequestError");
      assert.match(err.message, /nothing to retry/);
      return true;
    },
  );
});

// --- creating is not idempotent, so it is not retried ----------------------

test("create sends ONE request after a 500 — the run may already be charged", async () => {
  // The API has no idempotency key: repeating the same submission files a second
  // run with its own charge. So an ambiguous failure must not be retried, or the
  // client bills the caller twice for recovering from our error.
  const { fetch, calls } = scripted(
    err(500, "internal"),
    json(201, { id: "eval_never_reached", object: "evaluation", status: "queued" }),
  );
  await assert.rejects(
    () => client(fetch, { maxRetries: 5 }).evaluations.create({ video: { url: "https://x/y.mp4" } }),
    ServerError,
  );
  assert.equal(calls.length, 1, "a second POST would be a second evaluation");
});

test("create sends ONE request after a connection failure", async () => {
  // Worse than a 500: we do not even know the request arrived. It may have
  // arrived, created the run, and lost the response.
  let attempts = 0;
  const fetch = async () => {
    attempts++;
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    () => client(fetch, { maxRetries: 5 }).evaluations.create({ video: { url: "https://x/y.mp4" } }),
    ConnectionError,
  );
  assert.equal(attempts, 1);
});

test("but a 429 on create is still waited out — the server created nothing", async () => {
  // A refusal is knowledge, not ambiguity. Not retrying THIS would make the
  // no-retry rule useless for the case it matters least in.
  const { fetch, calls } = scripted(
    err(429, "rate_limited", "slow down", { "retry-after": "0" }),
    json(201, { id: "eval_1", object: "evaluation", status: "queued" }),
  );
  const ev = await client(fetch, { maxRetries: 0 }).evaluations.create({ video: { url: "https://x/y.mp4" } });
  assert.equal(ev.id, "eval_1");
  assert.equal(calls.length, 2);
});

test("retry() IS retried, because it is idempotent on the run being retried", async () => {
  const { fetch, calls } = scripted(
    err(500, "internal"),
    json(201, { id: "eval_2", object: "evaluation", status: "queued", retry_of: "eval_1" }),
  );
  const next = await client(fetch, { maxRetries: 2 }).evaluations.retry("eval_1");
  assert.equal(next.id, "eval_2");
  assert.equal(calls.length, 2, "a repeated retry is handed the same successor, so this is safe");
});

// --- a 429 loop that spends no time still has to end ----------------------

test("Retry-After: 0 forever is bounded by an attempt count, not by sleep", async () => {
  // The bug this covers: a budget measured in SLEEP does not bound a loop whose
  // sleeps are zero. With only that guard this spun as fast as the network
  // allowed, forever, even at budget 0.
  let calls = 0;
  const fetch = async () => {
    calls++;
    return err(429, "rate_limited", "slow down", { "retry-after": "0" });
  };
  await assert.rejects(
    () => client(fetch, { maxRetries: 0, maxRateLimitRetries: 4 }).account.credits(),
    RateLimitError,
  );
  assert.equal(calls, 5, "one attempt plus four absorbed 429s, then it gives up");
});

test("the wall-clock deadline also ends it, when the count is generous", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return err(429, "rate_limited", "slow down", { "retry-after": "0.05" });
  };
  const started = Date.now();
  await assert.rejects(
    () => client(fetch, { maxRetries: 0, maxRateLimitRetries: 10_000, rateLimitBudgetMs: 200 }).account.credits(),
    RateLimitError,
  );
  assert.ok(Date.now() - started < 5_000, "it must not run for anything like the count's worth of time");
  assert.ok(calls > 1 && calls < 10_000, `absorbed ${calls} — bounded by time, not by the count`);
});

test("a filtered iterate selects its statuses out of the census, not the whole of it", async () => {
  // `counts` ignores `status` by contract. Summing all of it while filtering
  // means walking to 105 when the filtered set has 5, asking for pages that come
  // back empty — and on a large account, many of them.
  const counts = { queued: 0, processing: 0, completed: 5, partial: 0, failed: 100 };
  const page = (ids) => json(200, {
    object: "list",
    data: ids.map((id) => ({ id, object: "evaluation", status: "completed" })),
    counts,
  });
  const { fetch, calls } = scripted(page(["a", "b", "c"]), page(["d", "e"]));

  const seen = [];
  for await (const ev of client(fetch).evaluations.iterate({ pageSize: 3, status: ["completed"] })) {
    seen.push(ev.id);
  }
  assert.deepEqual(seen, ["a", "b", "c", "d", "e"]);
  assert.equal(calls.length, 2, "105 would have kept it going for 33 more pages");
  for (const call of calls) {
    assert.equal(new URL(call.url).searchParams.get("status"), "completed");
  }
});

test("a status the census does not mention counts as zero rather than throwing", async () => {
  // A deployment that adds a status this client has not heard of must not break
  // paging for a client that is not asking for it.
  const { fetch, calls } = scripted(
    json(200, { object: "list", data: [], counts: { completed: 3 } }),
  );
  const seen = [];
  for await (const ev of client(fetch).evaluations.iterate({ status: ["cancelled"] })) seen.push(ev);
  assert.deepEqual(seen, []);
  assert.equal(calls.length, 1);
});
