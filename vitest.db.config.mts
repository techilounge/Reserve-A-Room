import { defineConfig } from "vitest/config";

// Database tests: real migrations applied to in-process Postgres (PGlite).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["supabase/tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
