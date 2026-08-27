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
