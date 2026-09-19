import { expect, test } from "@playwright/test";
import { dropFile, dropZone, fakeUuid, FAKE_UUID_PREFIXES, mockProviders } from "./helpers";

const clip = { name: "clip.mp4", mimeType: "video/mp4", size: 5 * 1024 * 1024 };

test("a dropped video is uploaded, stored and shown", async ({ page }) => {
  await mockProviders(page, fakeUuid());
  await page.goto("/");
  await dropFile(dropZone(page), clip);
  await expect(page.getByRole("heading", { name: "Uploaded" })).toBeVisible();
  await expect(page.getByText("1280 × 720")).toBeVisible();
  await expect(page.getByText("MP4", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Uploaded" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Uploaded" })).toBeVisible();
  expect(providers.multipartParts()).toBeGreaterThan(0);
});
