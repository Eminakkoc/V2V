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
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
};

const CORS_WITH_ETAG = { ...CORS, "access-control-expose-headers": "ETag" };

// The presigned part URLs @uploadcare/upload-client's multipartStart() returns.
const MULTIPART_HOST = "https://uploadcare.s3-accelerate.amazonaws.com";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function fileInfoJson(uuid: string) {
  const size = 5 * 1024 * 1024;
  return {
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
  };
}

export async function mockProviders(
  page: Page,
  uuid: string,
): Promise<{ uploads: () => number; multipartParts: () => number }> {
  let uploads = 0;
  let multipartParts = 0;
  await page.route("https://upload.uploadcare.com/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (pathname.startsWith("/base/")) {
      uploads += 1;
      return route.fulfill({ headers: CORS, json: { file: uuid } });
    }
    if (pathname.startsWith("/multipart/start/")) {
      uploads += 1;
      return route.fulfill({
        headers: CORS,
        json: { uuid, parts: [`${MULTIPART_HOST}/fake-bucket/${uuid}/part-1`] },
      });
    }
    if (pathname.startsWith("/multipart/complete/")) {
      return route.fulfill({ headers: CORS, json: fileInfoJson(uuid) });
    }
    if (pathname.startsWith("/info/")) {
      return route.fulfill({ headers: CORS, json: fileInfoJson(uuid) });
    }
    return route.fulfill({
      status: 404,
      headers: CORS,
      json: { error: { content: `unmocked ${pathname}` } },
    });
  });
  await page.route(`${MULTIPART_HOST}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    multipartParts += 1;
    return route.fulfill({ status: 200, headers: CORS_WITH_ETAG });
  });
  await page.route("https://res.cloudinary.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: TINY_PNG }),
  );
  return { uploads: () => uploads, multipartParts: () => multipartParts };
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
