import { defineConfig } from "vitest/config"

/** Only for `npx vitest run --config tests/evals/vitest.config.ts`. `npm test` never picks run.ts. */
export default defineConfig({
  test: {
    include: ["tests/evals/run.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
