import { RestClientError, type FileInfo } from "@uploadcare/rest-client";
import { describe, expect, it, vi } from "vitest";
import { createUploadcareAdapter } from "./uploadcare";

const keys = { publicKey: "pub", secretKey: "secret" };
const uuid = "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a";

function info(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    uuid,
    mimeType: "video/quicktime",
    size: 5_000_000,
    isReady: true,
    originalFileUrl: `https://ucarecdn.com/${uuid}/beach.mov`,
    originalFilename: "beach.mov",
    ...overrides,
  } as FileInfo;
}

function restError(status: number) {
  return new RestClientError("failed", { response: new Response(null, { status }) });
}

describe("Uploadcare adapter", () => {
  it("returns our own file-info type", async () => {
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () => info()),
    );
    await expect(adapter.getFileInfo(uuid)).resolves.toEqual({
      uuid,
      mimeType: "video/quicktime",
      size: 5_000_000,
      originalFileUrl: `https://ucarecdn.com/${uuid}/beach.mov`,
      originalFilename: "beach.mov",
    });
  });

  it("prefers the type Uploadcare sniffed from the bytes over the one the client declared", async () => {
    // An uploader that sends no Content-Type gets "application/octet-stream"
    // echoed back in mimeType, while contentInfo carries the real type.
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () =>
        info({
          mimeType: "application/octet-stream",
          contentInfo: { mime: { mime: "video/quicktime", type: "video", subtype: "quicktime" } },
        }),
      ),
    );
    await expect(adapter.getFileInfo(uuid)).resolves.toMatchObject({
      mimeType: "video/quicktime",
    });
  });

  it("falls back to the declared type when nothing was sniffed", async () => {
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () => info({ mimeType: "video/mp4", contentInfo: null })),
    );
    await expect(adapter.getFileInfo(uuid)).resolves.toMatchObject({ mimeType: "video/mp4" });
  });

  it("treats an unknown file as an invalid video URL", async () => {
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () => Promise.reject(restError(404))),
    );
    await expect(adapter.getFileInfo(uuid)).rejects.toMatchObject({ code: "INVALID_VIDEO_URL" });
  });

  it("asks to retry while the file is still processing", async () => {
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () => info({ isReady: false })),
    );
    await expect(adapter.getFileInfo(uuid)).rejects.toMatchObject({
      code: "UPLOADCARE_FAILED",
      retryable: true,
    });
  });

  it.each([
    [503, true],
    [429, true],
    [401, false],
    [403, false],
  ])("maps HTTP %d to UPLOADCARE_FAILED (retryable %s)", async (status, retryable) => {
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () => Promise.reject(restError(status))),
    );
    await expect(adapter.getFileInfo(uuid)).rejects.toMatchObject({
      code: "UPLOADCARE_FAILED",
      retryable,
    });
  });

  it("treats network failures as retryable", async () => {
    const adapter = createUploadcareAdapter(
      keys,
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    await expect(adapter.getFileInfo(uuid)).rejects.toMatchObject({
      code: "UPLOADCARE_FAILED",
      retryable: true,
    });
  });

  it("bounds the rest-client's own retries so one call cannot run away with the route's time budget", async () => {
    const fetchFileInfo = vi.fn(async () => info());
    const adapter = createUploadcareAdapter(keys, fetchFileInfo);
    await adapter.getFileInfo(uuid);
    expect(fetchFileInfo).toHaveBeenCalledWith(
      { uuid },
      expect.objectContaining({
        retryThrottledRequestMaxTimes: 1,
        retryNetworkErrorMaxTimes: 1,
      }),
    );
  });
});
