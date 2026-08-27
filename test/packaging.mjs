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

test("the package is publishable as a public scoped package with provenance", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "@physionlabs/galileo");
  // A scoped package defaults to restricted; without this the first publish
  // fails on a paid-plan error that says nothing about the real cause.
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.publishConfig.provenance, true);
  assert.equal(pkg.private, undefined, "a private package cannot be published at all");
});
