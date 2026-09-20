import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_WEBHOOK_SECRET } from "./env";
import {
  dropFile,
  dropZone,
  fakeMagicHourId,
  fakeUuid,
  mockProviders,
  signWebhook,
} from "./helpers";

const clip = { name: "clip.mp4", mimeType: "video/mp4", size: 5 * 1024 * 1024 };

async function uploadTrimAndChooseStyle(page: Page) {
  await mockProviders(page, fakeUuid());
  await page.goto("/");
  await dropFile(dropZone(page), clip);
  await expect(page.getByRole("heading", { name: "Uploaded" })).toBeVisible();

  // Trim: the source is a 12.5s fixture clip, narrow it to a 5s window. The
  // slider thumbs share these same accessible names, so scope to the number
  // inputs (role "spinbutton") specifically.
  await page.getByRole("spinbutton", { name: "Clip start" }).fill("1");
  await page.getByRole("spinbutton", { name: "Clip end" }).fill("6");

  await page.getByRole("combobox", { name: "Art style" }).click();
  await page.getByRole("option", { name: "Cyberpunk" }).click();
}

async function submitTransform(page: Page): Promise<{ job: { id: string } }> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith("/api/transform") && res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Transform" }).click(),
  ]);
  return response.json();
}

// Takes the already-serialized body, never an object to re-serialize: the
// signature is over these exact bytes, and re-stringifying risks producing
// bytes that no longer match what was signed.
async function postWebhook(
  request: APIRequestContext,
  rawBody: string,
  headers: Record<string, string>,
) {
  return request.post("/api/webhook", {
    data: rawBody,
    headers: { "content-type": "application/json", ...headers },
  });
}

function goodHeaders(rawBody: string) {
  const { signature, timestamp } = signWebhook(rawBody, E2E_WEBHOOK_SECRET);
  return { "magic-hour-event-signature": signature, "magic-hour-event-timestamp": timestamp };
}

test("upload, trim, choose a style and transform shows a job card immediately", async ({
  page,
}) => {
  await uploadTrimAndChooseStyle(page);
  const { job } = await submitTransform(page);

  const jobCard = page.getByRole("region", { name: "clip.mp4" });
  await expect(jobCard).toBeVisible();
  await expect(jobCard.getByText("Cyberpunk", { exact: false })).toBeVisible();
  await expect(jobCard.getByText("Queued", { exact: true })).toBeVisible();
  expect(job.id).toBeTruthy();
});

test("a correctly signed webhook completes the job and the result appears without a reload", async ({
  page,
  request,
}) => {
  test.setTimeout(45_000);
  await uploadTrimAndChooseStyle(page);
  const { job } = await submitTransform(page);

  const magicHourId = fakeMagicHourId(job.id);
  const rawBody = JSON.stringify({ type: "video.completed", payload: { id: magicHourId } });
  const response = await postWebhook(request, rawBody, goodHeaders(rawBody));
  expect(response.status()).toBe(200);

  // No page.reload() anywhere in this test: the update below can only reach
  // the DOM through useJobPolling's own backing-off refetch (3s -> 10s -> 30s),
  // so a generous timeout stands in for "allow a few intervals to pass".
  await expect(page.locator('video[aria-label="Result: clip.mp4"]')).toBeVisible({
    timeout: 20_000,
  });
  const jobCard = page.getByRole("region", { name: "clip.mp4" });
  await expect(jobCard.getByText("Complete", { exact: true })).toBeVisible();
});

test("a webhook with a bad signature is rejected and the job stays processing", async ({
  page,
  request,
}) => {
  await uploadTrimAndChooseStyle(page);
  const { job } = await submitTransform(page);

  const magicHourId = fakeMagicHourId(job.id);
  const rawBody = JSON.stringify({ type: "video.completed", payload: { id: magicHourId } });
  // Same shape as a real delivery, signed with the wrong secret: a well-formed
  // signature that the server must still reject, proving the fake provider's
  // verifyWebhook genuinely runs the real HMAC check rather than rubber-stamping.
  const { signature, timestamp } = signWebhook(rawBody, "not-the-configured-secret");
  const response = await postWebhook(request, rawBody, {
    "magic-hour-event-signature": signature,
    "magic-hour-event-timestamp": timestamp,
  });
  expect(response.status()).toBe(401);

  const history = await page.request.get("/api/history");
  const { items } = await history.json();
  const stored = items.find((item: { id: string }) => item.id === job.id);
  expect(stored).toBeTruthy();
  expect(stored.status).toBe("processing");
  expect(stored.output).toBeUndefined();

  // Still true after giving the polling hook a chance to pick up any (wrong) change.
  await page.waitForTimeout(3_500);
  await expect(page.locator('video[aria-label="Result: clip.mp4"]')).toHaveCount(0);
});

test("retry shows its confirmation and starts a second job linked to the first", async ({
  page,
  request,
}) => {
  test.setTimeout(45_000);
  await uploadTrimAndChooseStyle(page);
  const { job } = await submitTransform(page);

  const magicHourId = fakeMagicHourId(job.id);
  const rawBody = JSON.stringify({
    type: "video.errored",
    payload: { id: magicHourId, error: { code: "render_failed", message: "simulated failure" } },
  });
  const response = await postWebhook(request, rawBody, goodHeaders(rawBody));
  expect(response.status()).toBe(200);

  const retryButton = page.getByRole("button", { name: "Retry" });
  await expect(retryButton).toBeVisible({ timeout: 15_000 });
  await retryButton.click();

  const dialog = page.getByRole("alertdialog", { name: "Retry this clip?" });
  await expect(dialog).toBeVisible();

  const [retryResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith("/api/transform") && res.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Retry anyway" }).click(),
  ]);
  const retryBody = await retryResponse.json();
  expect(retryBody.job.retryOfJobId).toBe(job.id);
  expect(retryBody.job.id).not.toBe(job.id);

  const jobCard = page.getByRole("region", { name: "clip.mp4" });
  await expect(jobCard.getByText("Failed", { exact: false })).toHaveCount(0);
});

test("the create page has no WCAG 2.1 A/AA violations across idle, uploaded and complete states", async ({
  page,
  request,
}) => {
  test.setTimeout(45_000);
  const scan = () =>
    new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  await mockProviders(page, fakeUuid());
  await page.goto("/");
  await expect(dropZone(page).getByRole("button").first()).toBeEnabled();
  expect((await scan()).violations).toEqual([]);

  await dropFile(dropZone(page), clip);
  await expect(page.getByRole("heading", { name: "Uploaded" })).toBeVisible();
  expect((await scan()).violations).toEqual([]);

  await page.getByRole("combobox", { name: "Art style" }).click();
  await page.getByRole("option", { name: "Cyberpunk" }).click();
  const { job } = await submitTransform(page);

  const magicHourId = fakeMagicHourId(job.id);
  const rawBody = JSON.stringify({ type: "video.completed", payload: { id: magicHourId } });
  await postWebhook(request, rawBody, goodHeaders(rawBody));

  await expect(page.locator('video[aria-label="Result: clip.mp4"]')).toBeVisible({
    timeout: 20_000,
  });
  expect((await scan()).violations).toEqual([]);
});
