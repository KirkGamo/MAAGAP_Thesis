import { defineConfig } from "vitest/config";

/**
 * R1: the frontend's first test configuration.
 *
 * Scope is deliberately narrow for now — pure logic under src/lib and the
 * solver-mirroring constants — because that is where this project's frontend
 * bugs have actually been: a UTC+8 date shift that mislabelled every deployed
 * schedule and dated a completion a day early, and an RLS write that affected
 * zero rows while reporting success.
 *
 * Component and server-action tests need jsdom and a Supabase test double and
 * are the next step, not this one. Landing a runner that runs fast and green
 * matters more than landing a comprehensive one that nobody waits for.
 */
export default defineConfig({
  test: {
    // setupFiles runs before any test module, which is what lets the timezone
    // pin take effect before the first Date is constructed.
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    reporters: "default",
  },
});
