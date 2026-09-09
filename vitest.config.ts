import { defineConfig } from "vitest/config";
import path from "node:path";

// Pure-logic unit tests only for now (see CLAUDE.md) -- node environment,
// no jsdom/React Testing Library. Every test file lives next to the module
// it tests (src/lib/*.test.ts) rather than a separate top-level tests/
// tree, so a change to one is easy to find from the other. The "@/*" alias
// mirrors tsconfig.json's paths entry -- Vite doesn't read tsconfig path
// mappings on its own, so it has to be declared again here or any lib file
// that imports another lib via "@/lib/..." fails to resolve under Vitest.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
