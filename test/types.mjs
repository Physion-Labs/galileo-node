/**
 * Does the public parameter type let you omit what the contract lets you omit?
 *
 * The contract is the authority on this and it is machine-readable, so the list
 * in `src/types.ts` does not have to be trusted -- it is derived here and
 * compared. If the contract starts requiring `prompt` (PHY-93), this fails until
 * the list is updated, which is the point.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const yaml = readFileSync(join(root, "openapi", "galileo-v1.yaml"), "utf8");

/** The properties of `EvaluationCreate` that have a default and are not required. */
function omittableInCreate() {
  // Small hand-rolled read of one known block rather than a yaml dependency the
  // published package would have to carry.
  const block = yaml.slice(yaml.indexOf("\n    EvaluationCreate:"));
  const end = block.slice(1).search(/\n    [A-Za-z]/);
  const schema = block.slice(0, end + 1);

  const required = [...schema.matchAll(/^\s{6}- "?([a-z_]+)"?$/gm)].map((m) => m[1]);
  const props = [];
  const propsAt = schema.indexOf("      properties:");
  for (const m of schema.slice(propsAt).matchAll(/^\s{8}([a-z_]+):$/gm)) props.push(m[1]);

  const defaulted = props.filter((name) => {
    const at = schema.indexOf(`\n        ${name}:`);
    const next = schema.slice(at + 1).search(/\n {8}[a-z_]+:/);
    const body = next === -1 ? schema.slice(at) : schema.slice(at, at + 1 + next);
    return /\n\s+default:/.test(body);
  });
  return defaulted.filter((n) => !required.includes(n)).sort();
}

test("the create params type makes every server-defaulted field optional", () => {
  const omittable = omittableInCreate();
  assert.ok(omittable.length > 0, "parsed no defaulted-optional fields — the reader is broken");

  const listed = /type DefaultedByServer =([^;]+);/
    .exec(readFileSync(join(root, "src", "types.ts"), "utf8"))?.[1]
    .match(/"([a-z_]+)"/g)
    ?.map((s) => s.replaceAll('"', ""))
    .sort();

  assert.deepEqual(listed, omittable, "src/types.ts DefaultedByServer is out of step with the contract");
});

test("the documented one-line call compiles", () => {
  // The actual regression: this exact shape is what the README, the quickstart
  // and the docs all show, and against rc.3 it was a type error.
  const dir = mkdtempSync(join(tmpdir(), "galileo-types-"));
  try {
    const file = join(dir, "sample.ts");
    writeFileSync(
      file,
      // Against the BUILT output, which is what a customer's tsc sees.
      `import Galileo from "${join(root, "dist", "index.js")}";\n` +
        `const galileo = new Galileo({ apiKey: "gk_live_x" });\n` +
        `void galileo.evaluations.createAndWait({\n` +
        `  prompt: "A red ball rolls off a table and bounces twice.",\n` +
        `  video: { url: "https://example.com/video.mp4" },\n` +
        `});\n` +
        // A prompt on this one too: PHY-93 made it mandatory, so a call without
        // one is now correctly a type error rather than a shorter valid form.
        `void galileo.evaluations.create({\n` +
        `  prompt: "A red ball rolls off a table.",\n` +
        `  video: { url: "https://example.com/v.mp4" },\n` +
        `});\n`,
    );
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
       "--moduleResolution", "NodeNext", "--skipLibCheck", file],
      { cwd: root, stdio: "pipe" },
    );
  } catch (e) {
    assert.fail(`the documented call does not typecheck:\n${e.stdout?.toString() ?? e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
