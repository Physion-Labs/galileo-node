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
void client.evaluations.create({ model: "galileo-pm", input: { video: { path: "./video.mp4" }, prompt: "A ball rolls." } });
void client.evaluations.create({ model: "galileo-pm", input: { video: { url: "https://example.com/v.mp4" } } });
void client.evaluations.submit({ model: "galileo-pm", input: { video: { upload_id: "vid_1" } } });
// model may be omitted; it defaults to galileo-pm
void client.evaluations.create({ input: { video: { path: "x" }, prompt: "x" } });
// @ts-expect-error galileo-1.0 is not an API model
void client.evaluations.create({ model: "galileo-1.0", input: { video: { path: "x" }, prompt: "x" } });
// @ts-expect-error video is required
void client.evaluations.create({ model: "galileo-pm", input: { prompt: "x" } });
// @ts-expect-error use nested input
void client.evaluations.create({ model: "galileo-pm", video: { url: "x" } });
// @ts-expect-error a video reference has one source
void client.evaluations.create({ model: "galileo-pm", input: { video: { path: "x", url: "https://example.com/x" } } });
// @ts-expect-error unknown input fields must not silently disappear
void client.evaluations.create({ model: "galileo-pm", input: { video: { path: "x" }, promt: "x" } });
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

test("galileo-pm is a model id the declarations accept", () => {
  // rc.8's ModelId was "galileo-pm" | "galileo", so a TypeScript caller could
  // not name galileo-pm, nor narrow a listed model to it, without a cast.
  const dir = mkdtempSync(join(tmpdir(), "galileo-types-"));
  try {
    const file = join(dir, "pm.ts");
    writeFileSync(file, `
import { Client, type ModelId, type ModelList } from "${join(root, "dist", "index.js")}";
const client = new Client({ apiKey: "test" });
void client.evaluations.create({ model: "galileo-pm", input: { video: { url: "https://example.com/v.mp4" }, prompt: "A ball rolls." } });
const id: ModelId = "galileo-pm";
declare const list: ModelList;
void list.data.filter((m) => m.id === "galileo-pm");
void id;
`);
    execFileSync("pnpm", ["exec", "tsc", "--noEmit", "--strict", "--target", "ES2022",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", file],
      { cwd: root, stdio: "pipe" });
  } catch (e) {
    assert.fail(e.stdout?.toString() ?? e.message);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
