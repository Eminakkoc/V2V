import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_WEBHOOK_SECRET } from "./env";
import {
  dropZone,
  fakeMagicHourId,
  fakeUuid,
  mockProviders,
  settleForAxe,
  signWebhook,
} from "./helpers";

// Axe measures the settled page. On "/" the drop zone's buttons stay disabled
// until the uploader's dynamic import resolves, and axe reports their muted
// disabled palette as a contrast violation if it runs first. WCAG 1.4.3 exempts
// inactive components, so waiting measures the state the bar actually applies
// to instead of racing the import.
const pages: { path: string; settled: (page: Page) => Promise<void> }[] = [
  {
    path: "/",
    settled: (page) => expect(dropZone(page).getByRole("button").first()).toBeEnabled(),
  },
  {
    path: "/history",
    settled: (page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
  },
];

for (const { path, settled } of pages) {
  test(`${path} has no WCAG 2.1 A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await settled(page);
    await settleForAxe(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

// A separate test, not a third entry in `pages` above: that loop titles each
// test after its bare path, and a second "/history" entry would collide with
// the empty-list one already covered there. Rate-limit spend for this job is
// tallied in e2e/history.spec.ts's own top-of-file comment -- this is the
// "a11y.spec.ts (populated)" line, desktop-only for the same shared-per-IP
// reason that file gives.
test("/history (with a transformation) has no WCAG 2.1 A/AA violations", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "seeds a job against the per-IP rate-limit window every e2e spec shares; desktop-only, same as history.spec.ts",
  );

  // The completed job's card renders a <video poster> pointing at Cloudinary
  // (see video-pair.tsx); without this the browser attempts a real fetch for
  // that poster against a URL that only the fake provider knows about.
  await mockProviders(page, fakeUuid());

  const uploadResponse = await page.request.post("/api/upload", {
    data: { cdnUrl: `https://ucarecdn.com/${fakeUuid()}/` },
  });
  expect(uploadResponse.status()).toBe(200);
  const { sourceId } = await uploadResponse.json();

  const transformResponse = await page.request.post("/api/transform", {
    data: {
      sourceId,
      idempotencyKey: randomUUID(),
      params: {
        name: "a11y clip",
        startSeconds: 0,
        endSeconds: 5,
        fpsResolution: "HALF",
        artStyle: "Cyberpunk",
        promptType: "default",
        model: "default",
        version: "default",
      },
    },
  });
  expect(transformResponse.status()).toBe(202);
  const { job } = await transformResponse.json();

  // Delivered directly rather than left to reconciliation's background pass
  // (GET /api/history schedules one on every request) so the card the scan
  // sees is deterministically "Complete", not whatever state a race happened
  // to leave it in.
  const rawBody = JSON.stringify({
    type: "video.completed",
    payload: { id: fakeMagicHourId(job.id) },
  });
  const { signature, timestamp } = signWebhook(rawBody, E2E_WEBHOOK_SECRET);
  const webhookResponse = await page.request.post("/api/webhook", {
    data: rawBody,
    headers: {
      "content-type": "application/json",
      "magic-hour-event-signature": signature,
      "magic-hour-event-timestamp": timestamp,
    },
  });
  expect(webhookResponse.status()).toBe(200);

  await page.goto("/history");
  await expect(page.getByRole("region", { name: "a11y clip" })).toBeVisible();
  await settleForAxe(page);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
