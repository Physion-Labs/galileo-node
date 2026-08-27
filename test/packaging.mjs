/**
 * What actually ships.
 *
 * A package can typecheck, test green, and still be broken on install: a stray
 * import of a devDependency, types that point at a file `files` does not
 * publish, or a CJS build that has no usable default. None of those show up
 * until somebody installs it, which is the worst time to find out.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), "utf8");

test("the bundle imports nothing but node builtins", () => {
  for (const file of ["dist/index.js", "dist/index.cjs"]) {
    const src = read(file);
    const specifiers = [
      ...src.matchAll(/(?:from\s*|require\()\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const spec of specifiers) {
      // Against the real builtin list rather than the `node:` prefix. The source
      // writes `node:crypto` and the bundler emits `crypto`; that is fine, since
      // Node resolves core modules ahead of node_modules and so a bare builtin
      // cannot be shadowed. What must not appear is anything third-party — this
      // package declares no runtime dependencies, and a devDependency that
      // leaked into the bundle would break on install, not in CI.
      const bare = spec.replace(/^node:/, "");
      assert.ok(
        builtinModules.includes(bare),
        `${file} pulls in ${spec}, which is not a Node builtin`,
      );
    }
  }
});

test("the published types do not point at files the package omits", () => {
  const dts = read("dist/index.d.ts");
  // `internal/contract.d.ts` is generated and not in `files`. If the emitted
  // declarations IMPORTED it, every consumer's typecheck would fail on an
  // unresolvable path — and that is invisible from inside the repo, where the
  // file is right there.
  //
  // Matching import statements rather than the bare string, because the first
  // version of this test matched a doc comment that merely names the file. A
  // check that fires on prose is a check people learn to route around.
  const specifiers = [...dts.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of specifiers) {
    assert.equal(
      /internal\/contract|openapi\//.test(spec),
      false,
      `types import ${spec}, which the package does not publish`,
    );
  }
});

test("the types carry the schema shapes inline, so callers get real fields", () => {
  const dts = read("dist/index.d.ts");
  // Being aliases into a generated file, these could have been erased to `any`
  // by a bad emit. Spot-check that a field survived.
  assert.match(dts, /has_prompt_misalignment/);
  assert.match(dts, /prompt_segment/);
});

test("require() gets a usable default, not a module namespace", () => {
  const require = createRequire(import.meta.url);
  const cjs = require(join(root, "dist/index.cjs"));
  const Galileo = cjs.default ?? cjs;
  assert.equal(typeof Galileo, "function");
  const client = new Galileo({ apiKey: "gk_live_test" });
  assert.ok(client.evaluations);
});

test("`files` publishes the built output and nothing else", () => {
  const pkg = JSON.parse(read("package.json"));
  // LICENSE and NOTICE are not optional extras: Apache-2.0 section 4 requires
  // both to travel with any distribution, and npm publishes only what `files`
  // names. Leaving them out ships a package whose own license terms it breaks.
  assert.deepEqual(pkg.files, ["dist", "README.md", "LICENSE", "NOTICE"]);
  assert.equal(pkg.license, "Apache-2.0");
  // Anything the loader can reach has to be inside `files`, or an install is
  // missing the file its own package.json names.
  for (const entry of [pkg.main, pkg.module, pkg.types]) {
    assert.match(entry, /^\.\/dist\//, `${entry} is outside the published files`);
  }
});

test("the package is publishable as a public scoped package", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "@physionlabs/galileo");
  // A scoped package defaults to restricted; without this the first publish
  // fails on a paid-plan error that says nothing about the real cause.
  assert.equal(pkg.publishConfig.access, "public");
  // `provenance` is deliberately NOT here, and this asserts its absence.
  //
  // It was, and it broke the first publish: npm can only generate provenance
  // inside a supported CI provider, so `npm publish` from a laptop fails with
  // "Automatic provenance generation not supported for provider: null".
  // publishConfig applies to EVERY publish, including the ones a person runs by
  // hand — which is exactly the case the first release of a package is.
  //
  // Nothing is lost: trusted publishing generates provenance on its own, so the
  // flag was redundant where it worked and fatal where it did not.
  assert.equal(pkg.publishConfig.provenance, undefined,
    "provenance in publishConfig breaks any publish outside CI");
  assert.equal(pkg.private, undefined, "a private package cannot be published at all");
});

test("the two clients export the same module-level constants", async () => {
  // THIS TEST EXISTS BECAUSE ITS ABSENCE HID A BUG. The parity check below
  // compared resources, methods and error classes, concluded "identical", and
  // said nothing about constants — so `DEFAULT_BASE_URL` shipped in the Python
  // client and not in this one, and the first person to ask "which backend does
  // the SDK point at?" got `undefined` from the published package.
  //
  // Mirrors the non-class, non-type entries of physionlabs/__init__.py's
  // `__all__`. Types are excluded on purpose: TypeScript erases them, so a type
  // Python exposes as a runtime pydantic class has no runtime counterpart here
  // and its absence from this object is not a gap.
  const mod = await import("../dist/index.js");

  assert.equal(typeof mod.DEFAULT_BASE_URL, "string");
  assert.equal(mod.DEFAULT_BASE_URL, "https://api.physionlabs.ai",
    "the shipped default is PRODUCTION — only the test suites default to dev");
  assert.match(mod.VERSION, /^\d+\.\d+\.\d+/, "VERSION is Python's __version__");
});

test("VERSION cannot drift from package.json", async () => {
  // It is a copy, because `exports` deliberately does not expose the manifest —
  // so nothing can read the version at runtime, including the package itself.
  // A copy that nothing checks is a package that misreports its own version.
  const pkg = JSON.parse(read("package.json"));
  const mod = await import("../dist/index.js");
  assert.equal(mod.VERSION, pkg.version);
});

test("the two clients export the same error names", async () => {
  // The Node and Python clients are one API with two front doors, and a caller
  // porting between them should not have to learn different exception names for
  // the same condition. Checked here because a rename is easy and silent: the
  // first version of this package called the poll timeout `TimeoutError`, which
  // Python did not, and nothing noticed until a smoke test reached for the wrong
  // one.
  const mod = await import("../dist/index.js");
  // Mirrors `__all__` in physionlabs/__init__.py.
  for (const name of [
    "GalileoError",
    "InvalidRequestError",
    "AuthenticationError",
    "NotFoundError",
    "InsufficientCreditsError",
    "RateLimitError",
    "ServerError",
    "ConnectionError",
    "PollTimeoutError",
    "APIError",
  ]) {
    assert.equal(typeof mod[name], "function", `${name} is missing or is not a class`);
  }
  assert.equal(mod.TimeoutError, undefined, "the old name should not linger as an alias");
});

test("the README does not claim the package is unpublished", () => {
  // The README ships inside the tarball and is what npm renders on the package
  // page, so a "not published yet" line is read by everyone who arrives at a
  // published package. It stayed there through the first two releases.
  const readme = read("README.md");
  for (const stale of ["Not published yet", "does not exist on npm", "under construction"]) {
    assert.equal(readme.includes(stale), false, `README still says "${stale}"`);
  }
  // And it must still say what it IS, so removing the claim does not mean
  // removing the caveat.
  assert.match(readme, /Release candidate|not final until/);
});
