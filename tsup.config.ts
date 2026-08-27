import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "node20",
  // No runtime dependencies: the client is fetch plus node:fs. Bundling is here
  // to emit both module formats from one source, not to vendor anything.
  external: [],
});
