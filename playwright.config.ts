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
    // history-sheet.spec.ts drives the phone-only Filter sheet, which the
    // FilterBar renders under a `md:hidden` class -- on the desktop viewport
    // its trigger exists but is never visible, so that spec is mobile-only.
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /history-sheet\.spec\.ts/,
    },
    // Both of these seed jobs or need no viewport, and every seed draws down
    // the per-IP rate-limit window that all specs share.
    //
    // Budget as of 36aec0d: upload 29/30, transform 22/30 (per-IP, per
    // scope, 30 per 10 minutes) -- upload headroom is down to ONE hit.
    // Adding any spec that uploads, or running an existing upload/transform
    // spec under a second project, requires re-running the tally first (see
    // e2e/history.spec.ts's header for the full breakdown), or the next
    // failure here reads as flaky rather than a budget overrun (L-007).
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
