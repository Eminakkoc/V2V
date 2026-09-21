import { expect, test } from "@playwright/test";
import {
  dropFile,
  dropZone,
  expectUploaded,
  fakeUuid,
  FAKE_UUID_PREFIXES,
  mockProviders,
} from "./helpers";

const clip = { name: "clip.mp4", mimeType: "video/mp4", size: 5 * 1024 * 1024 };

test("a dropped video is uploaded, stored and shown", async ({ page }) => {
  await mockProviders(page, fakeUuid());
  await page.goto("/");
  await dropFile(dropZone(page), clip);
  await expectUploaded(page, clip.name);
  // Format, size, dimensions and duration share one line under the file name.
  await expect(page.getByText(/^MP4 · .+ · 1280 × 720 · /)).toBeVisible();
});

test("an oversize video is refused before any upload", async ({ page }) => {
  const providers = await mockProviders(page, fakeUuid());
  await page.goto("/");
  await dropFile(dropZone(page), {
    name: "big.mp4",
    mimeType: "video/mp4",
    size: 105 * 1024 * 1024,
  });
  await expect(page.locator("#upload-error")).toContainText("Maximum size is 100 MB.");
  expect(providers.uploads()).toBe(0);
});

test("a failed copy is retried without uploading again", async ({ page }) => {
  const providers = await mockProviders(page, fakeUuid(FAKE_UUID_PREFIXES.failsOnce));
  await page.goto("/");
  await dropFile(dropZone(page), clip);
  await expect(page.locator("#upload-error")).toContainText("We couldn't store your video");
  await page.getByRole("button", { name: "Try again" }).click();
  await expectUploaded(page, clip.name);
  expect(providers.uploads()).toBe(1);
});

test("an unreadable video asks for another file", async ({ page }) => {
  await mockProviders(page, fakeUuid(FAKE_UUID_PREFIXES.unreadable));
  await page.goto("/");
  await dropFile(dropZone(page), clip);
  await expect(page.locator("#upload-error")).toContainText("Can't read the video");
  await expect(page.getByRole("button", { name: "Choose another file" })).toBeVisible();
});

test("a file at the multipart threshold is uploaded over the S3 host", async ({ page }) => {
  const providers = await mockProviders(page, fakeUuid());
  await page.goto("/");
  await dropFile(dropZone(page), {
    name: "large.mp4",
    mimeType: "video/mp4",
    size: 27 * 1024 * 1024,
  });
  await expectUploaded(page, "large.mp4");
  expect(providers.multipartParts()).toBeGreaterThan(0);
});

test("an upload logs no blocked-request errors", async ({ page }) => {
  // The uploader's telemetry host is deliberately absent from connect-src, so asserting silence
  // here is what keeps that opt-out working.
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
      blocked.push(message.text());
    }
  });
  await mockProviders(page, fakeUuid());
  await page.goto("/");
  await dropFile(dropZone(page), clip);
  await expectUploaded(page, clip.name);
  expect(blocked).toEqual([]);
});
