import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The recovery spec is API-only — no page, no viewport — so a second run of
    // it proves nothing and only draws down the per-IP rate-limit window that
    // every spec shares (RATE_LIMITS.perIp, 30 per 10 minutes per scope).
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      testIgnore: /transform-recovery\.spec\.ts/,
    },
  ],
  webServer: {
    command: "pnpm exec tsx e2e/serve.ts",
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
