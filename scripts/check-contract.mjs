/**
 * Is this SDK still describing the contract it claims to?
 *
 * Two failures are possible and only one of them is obvious.
 *
 * The obvious one: the committed types drift from the contract. Someone edits
 * `contract.d.ts` by hand, or the contract is synced and the types are not, and
 * from then on the SDK's public surface is a claim nothing backs. Caught by
 * regenerating and diffing.
 *
 * The quiet one: the CONTRACT is edited here. This repo holds a copy of a file
 * authored upstream, and a copy is only useful while it is a copy -- a change
 * made here would make this SDK correct against a contract the running service
 * has never heard of, which is worse than being out of date, because being out
 * of date is visible. Caught by hashing against `openapi/SOURCE`.
 *
 * `openapi/SOURCE` is provenance, not a signature: someone can edit the yaml and
 * update the hash. That is fine and deliberate -- the point is that doing so is
 * an explicit act that shows up in a diff, rather than something a stray editor
 * save can accomplish.
 *
 *   node scripts/check-contract.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contract = join(root, "openapi", "galileo-v1.yaml");
const types = join(root, "src", "internal", "contract.d.ts");

const problems = [];

// --- 1. the copy is still the copy -----------------------------------------
const source = readFileSync(join(root, "openapi", "SOURCE"), "utf8");
const recorded = /^sha256\s*=\s*([0-9a-f]{64})$/m.exec(source)?.[1];
const actual = createHash("sha256").update(readFileSync(contract)).digest("hex");

if (!recorded) {
  problems.push("openapi/SOURCE records no sha256 line.");
} else if (recorded !== actual) {
  problems.push(
    `openapi/galileo-v1.yaml does not match the revision openapi/SOURCE names.\n` +
      `  recorded ${recorded}\n  actual   ${actual}\n` +
      `If you synced a new contract from upstream, update SOURCE (commit AND sha256).\n` +
      `If you edited the contract here, don't: change it upstream and sync.`,
  );
}

// --- 2. the types are still generated from it -------------------------------
const scratch = join(root, "src", "internal", ".contract.check.d.ts");
try {
  execFileSync("pnpm", ["exec", "openapi-typescript", contract, "-o", scratch], {
    cwd: root,
    stdio: "pipe",
  });
  const generated = readFileSync(scratch, "utf8");
  const committed = readFileSync(types, "utf8");
  if (generated !== committed) {
    problems.push(
      "src/internal/contract.d.ts is not what the contract generates.\n" +
        "  Run `pnpm contract:types` and commit the result.",
    );
  }
} catch (e) {
  problems.push(`could not regenerate the contract types: ${e.message}`);
} finally {
  rmSync(scratch, { force: true });
}

if (problems.length) {
  console.error(`\n${problems.join("\n\n")}\n`);
  process.exit(1);
}
console.log("Contract copy and generated types are in step.");
