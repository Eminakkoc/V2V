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
    // history-sheet.spec.ts drives the phone-only Filter sheet, whose trigger exists but is never visible on the desktop viewport.
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /history-sheet\.spec\.ts/,
    },
    // Both seed jobs and draw down the per-IP rate-limit window every spec shares, so adding another uploading spec needs the budget tally re-run first (see e2e/history.spec.ts's header).
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      testIgnore: /transform-recovery\.spec\.ts|history\.spec\.ts/,
    },
  ],
  webServer: {
    command: "pnpm exec tsx e2e/serve.ts",
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
