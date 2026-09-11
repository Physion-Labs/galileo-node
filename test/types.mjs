/** Compile the new quickstart and invalid inputs against the published declarations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;

test("Client accepts local/remote input, optional prompt, and keeps legacy Galileo calls typed", () => {
  const dir = mkdtempSync(join(tmpdir(), "galileo-types-"));
  try {
    const file = join(dir, "sample.ts");
    writeFileSync(file, `
import Galileo, { Client, type EvaluationCreateParams } from "${join(root, "dist", "index.js")}";
const client = new Client({ apiKey: "test" });
void client.evaluations.create({ model: "galileo-1.0", input: { video: { path: "./video.mp4" }, prompt: "A ball rolls." } });
void client.evaluations.create({ model: "galileo-1.0", input: { video: { url: "https://example.com/v.mp4" } } });
void client.evaluations.submit({ model: "galileo-1.0", input: { video: { upload_id: "vid_1" } } });
// @ts-expect-error model is required
void client.evaluations.create({ input: { video: { path: "x" } } });
// @ts-expect-error video is required
void client.evaluations.create({ model: "galileo-1.0", input: { prompt: "x" } });
// @ts-expect-error use nested input
void client.evaluations.create({ model: "galileo-1.0", video: { url: "x" } });
// @ts-expect-error a video reference has one source
void client.evaluations.create({ model: "galileo-1.0", input: { video: { path: "x", url: "https://example.com/x" } } });
// @ts-expect-error unknown input fields must not silently disappear
void client.evaluations.create({ model: "galileo-1.0", input: { video: { path: "x" }, promt: "x" } });
const legacy = new Galileo({ apiKey: "test" });
void legacy.evaluations.create({ video: { url: "https://example.com/v.mp4" } });
void legacy.evaluations.createAndWait({ prompt: "A ball rolls.", video: { url: "https://example.com/v.mp4" } });
`);
    execFileSync("pnpm", ["exec", "tsc", "--noEmit", "--strict", "--target", "ES2022",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", file],
      { cwd: root, stdio: "pipe" });
  } catch (e) {
    assert.fail(e.stdout?.toString() ?? e.message);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
