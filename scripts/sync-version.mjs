/**
 * Keep `src/version.ts` equal to package.json's version.
 *
 * The version cannot be read from package.json at runtime: `exports` does not
 * expose the manifest, on purpose — a package that lets consumers reach into its
 * own files has no encapsulation. So it is copied into a source file, and copies
 * drift, so this is what stops that.
 *
 * Run by `pnpm build`, and checked by test/packaging.mjs. A bump to package.json
 * that forgets this fails the suite rather than shipping a package that reports
 * the wrong version of itself.
 *
 *   node scripts/sync-version.mjs [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const file = join(root, "src", "version.ts");
const want = readFileSync(file, "utf8").replace(/export const VERSION = "[^"]*";/, `export const VERSION = "${version}";`);

if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== want) {
    console.error(`src/version.ts does not say ${version}. Run \`node scripts/sync-version.mjs\`.`);
    process.exit(1);
  }
  console.log(`src/version.ts agrees with package.json (${version}).`);
} else {
  writeFileSync(file, want);
  console.log(`src/version.ts → ${version}`);
}
