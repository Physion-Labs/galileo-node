/** Construction, and the two things a caller gets wrong first. */

import test from "node:test";
import assert from "node:assert/strict";
import Galileo, { Galileo as Named, AuthenticationError } from "../dist/index.js";

test("the default export and the named export are the same class", () => {
  assert.equal(Galileo, Named);
});

test("a client refuses to exist without a key", () => {
  const saved = process.env.GALILEO_API_KEY;
  delete process.env.GALILEO_API_KEY;
  try {
    assert.throws(() => new Galileo(), /No API key/);
  } finally {
    if (saved !== undefined) process.env.GALILEO_API_KEY = saved;
  }
});

test("the key can come from the environment, so it need not be in the source", () => {
  const saved = process.env.GALILEO_API_KEY;
  process.env.GALILEO_API_KEY = "gk_live_env";
  try {
    const galileo = new Galileo();
    assert.ok(galileo.evaluations);
    assert.ok(galileo.videos);
    assert.ok(galileo.account);
  } finally {
    if (saved === undefined) delete process.env.GALILEO_API_KEY;
    else process.env.GALILEO_API_KEY = saved;
  }
});

test("the error classes are exported, because catching them is the point", () => {
  const err = new AuthenticationError({
    status: 401,
    type: "authentication_error",
    code: "invalid_api_key",
    message: "nope",
  });
  assert.equal(err.name, "AuthenticationError");
  assert.equal(err.status, 401);
  assert.ok(err instanceof Error);
});

test("catching GalileoError catches the failures where the API never answered", async () => {
  // This is a behavioural difference, not a naming one. `GalileoError` used to be
  // the class carrying a status code, so `instanceof GalileoError` did NOT catch a
  // connection failure — while the same line in Python did. A caller porting
  // between the two would have silently lost a branch.
  //
  // Now: GalileoError is everything, APIError is "the server answered and said
  // no", and only the second has a status.
  const { GalileoError, APIError, ConnectionError, PollTimeoutError, ServerError } =
    await import("../dist/index.js");

  const connection = new ConnectionError("no route");
  assert.ok(connection instanceof GalileoError, "a connection failure is a client error");
  assert.equal(connection instanceof APIError, false, "but the API never answered, so no status");

  const poll = new PollTimeoutError("gave up");
  assert.ok(poll instanceof GalileoError);
  assert.equal(poll instanceof APIError, false);

  const server = new ServerError({ status: 500, type: "api_error", code: "internal", message: "boom" });
  assert.ok(server instanceof APIError, "a 500 is the server answering");
  assert.ok(server instanceof GalileoError);
  assert.equal(server.status, 500);

  // The names survive minification-free bundling, which is what a caller reads
  // in a log.
  assert.equal(connection.name, "ConnectionError");
  assert.equal(poll.name, "PollTimeoutError");
  assert.equal(server.name, "ServerError");
});
