import { defineConfig } from "vitest/config";

// Unit tests for every TS package (`pnpm test`). Coverage minimums are
// ratcheted up as packages gain tests; see docs/coding-standards.md.
export default defineConfig({
  test: {
    include: ["{apps,platform,modules}/**/src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["{apps,platform,modules}/**/src/**/*.{ts,tsx}"],
      exclude: ["**/api/ts/**", "**/*.gen.ts", "**/*.test.{ts,tsx}"],
      reporter: ["text-summary"],
      thresholds: { lines: 0 },
    },
  },
});
