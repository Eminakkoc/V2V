import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";

// Must match FAKE_UUID_PREFIXES in src/server/providers/fakes.ts.
export const FAKE_UUID_PREFIXES = { failsOnce: "f0000000-", unreadable: "e0000000-" } as const;

export function fakeUuid(prefix = ""): string {
  const uuid = randomUUID();
  return `${prefix}${uuid.slice(prefix.length)}`;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export async function mockProviders(page: Page, uuid: string): Promise<{ uploads: () => number }> {
  let uploads = 0;
  await page.route("https://upload.uploadcare.com/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (pathname.startsWith("/base/")) {
      uploads += 1;
      return route.fulfill({ headers: CORS, json: { file: uuid } });
    }
    if (pathname.startsWith("/info/")) {
      const size = 5 * 1024 * 1024;
      return route.fulfill({
        headers: CORS,
        json: {
          size,
          done: size,
          total: size,
          uuid,
          file_id: uuid,
          original_filename: "clip.mp4",
          filename: "clip.mp4",
          mime_type: "video/mp4",
          is_image: false,
          is_stored: true,
          is_ready: true,
          image_info: null,
          video_info: null,
          content_info: null,
          metadata: {},
          tags: {},
        },
      });
    }
    return route.fulfill({
      status: 404,
      headers: CORS,
      json: { error: { content: `unmocked ${pathname}` } },
    });
  });
  await page.route("https://res.cloudinary.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: TINY_PNG }),
  );
  return { uploads: () => uploads };
}

export function dropZone(page: Page): Locator {
  return page.getByRole("group", { name: "Drop a video here" });
}

export async function dropFile(
  target: Locator,
  file: { name: string; mimeType: string; size: number },
) {
  const dataTransfer = await target.page().evaluateHandle(({ name, mimeType, size }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(size)], name, { type: mimeType }));
    return transfer;
  }, file);
  await target.dispatchEvent("drop", { dataTransfer });
}
