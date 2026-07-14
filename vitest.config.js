import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // The workerd bundled with the current test pool supports dates through 2026-07-02.
        // Keep production's newer date in wrangler.jsonc and pin only the local test runtime.
        compatibilityDate: "2026-07-02",
        bindings: {
          LINUXDO_CLIENT_SECRET: "test-linuxdo-client-secret",
          SESSION_JWT_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
        },
      },
    }),
  ],
  test: {
    include: ["tests/worker/**/*.test.js"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
});
