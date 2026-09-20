import { createHmac, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";

// Must match FAKE_UUID_PREFIXES in src/server/providers/fakes.ts.
export const FAKE_UUID_PREFIXES = {
  failsOnce: "f0000000-",
  unreadable: "e0000000-",
  longSource: "d0000000-",
} as const;

// Must match FAKE_JOB_NAME_TRIGGERS in src/server/providers/fakes.ts. Put one
// of these in the job name to steer the fake provider down a branch it would
// otherwise never reach: an uncertain create (no magicHourId, so the webhook's
// v2v:<jobId> name fallback is the only way back to the job), a Cloudinary
// copy that fails once / permanently inside finalize, or a getJobDetails
// status other than the default "complete".
export const FAKE_JOB_NAME_TRIGGERS = {
  createUncertain: "fake:create-uncertain",
  copyFailsOnce: "fake:copy-fails-once",
  copyUnreadable: "fake:copy-unreadable",
  statusRendering: "fake:status-rendering",
  statusError: "fake:status-error",
  statusCanceled: "fake:status-canceled",
} as const;

export function fakeUuid(prefix = ""): string {
  const uuid = randomUUID();
  return `${prefix}${uuid.slice(prefix.length)}`;
}

// Must match fakeMagicHourId in src/server/providers/fakes.ts. Pass the same
// FAKE_UUID_PREFIXES value the job name asked for, because createJob encodes
// the copy trigger into the id it hands back. statusTag (one of "rendering" /
// "error" / "canceled") trails the id rather than leading it, because the
// copy prefix has to stay the first path segment of the download URL.
export function fakeMagicHourId(jobId: string, copyPrefix = "", statusTag = ""): string {
  const tail = statusTag ? `~s=${statusTag}` : "";
  return `fake-mh-${copyPrefix}${jobId}${tail}`;
}

// The job name Magic Hour reports back, which the webhook's resolveJob parses
// with parseJobName when findByMagicHourId misses. Must match buildJobName in
// src/server/providers/magic-hour-mapping.ts.
export function fakeJobName(jobId: string, userName: string): string {
  return `v2v:${jobId} ${userName}`.slice(0, 120);
}

// Reimplements the HMAC scheme src/server/providers/magic-hour-signature.ts verifies,
// so a simulated webhook delivery is authenticated the same way a real one is -- there
// is deliberately no test-only bypass of that check.
export function signWebhook(
  rawBody: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): { signature: string; timestamp: string } {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return { signature, timestamp: String(timestamp) };
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
