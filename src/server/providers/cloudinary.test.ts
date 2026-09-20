import { describe, expect, it, vi } from "vitest";
import { createCloudinaryAdapter, MIN_RETRY_BUDGET_MS, type CloudinaryUpload } from "./cloudinary";

const credentials = { cloudName: "demo", apiKey: "key", apiSecret: "secret" };
const url = "https://ucarecdn.com/3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a/beach.mov";

function uploaded(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "sources/abc",
    secure_url: "https://res.cloudinary.com/demo/video/upload/v1/sources/abc.mov",
    format: "mov",
    bytes: 1_000_000,
    duration: 12.5,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

function adapterWith(upload: CloudinaryUpload, now = () => 0) {
  return createCloudinaryAdapter(credentials, { upload, sleep: async () => {}, now });
}

const options = { deadline: 50_000 };

describe("Cloudinary adapter", () => {
  it("copies by URL into sources with a random public id and maps the result", async () => {
    const upload = vi.fn(async () => uploaded());
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).resolves.toEqual({
      publicId: "sources/abc",
      secureUrl: "https://res.cloudinary.com/demo/video/upload/v1/sources/abc.mov",
      format: "mov",
      bytes: 1_000_000,
      duration: 12.5,
      width: 1080,
      height: 1920,
    });
    expect(upload).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        resource_type: "video",
        overwrite: true,
        asset_folder: "sources",
        public_id: expect.stringMatching(/^sources\/[0-9a-f-]{36}$/),
        timeout: 50_000,
      }),
    );
  });

  it("retries a transient failure once with the same public id", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce({ message: "Server error", http_code: 500 })
      .mockResolvedValueOnce(uploaded());
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).resolves.toMatchObject({
      publicId: "sources/abc",
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]?.[1].public_id).toBe(upload.mock.calls[1]?.[1].public_id);
  });

  it.each([499, 420, 429, 503])("treats HTTP %d as transient", async (httpCode) => {
    const upload = vi.fn(async () => Promise.reject({ message: "x", http_code: httpCode }));
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: true,
    });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("returns a deterministic failure at once", async () => {
    const upload = vi.fn(async () =>
      Promise.reject({ message: "Unsupported video format or file", http_code: 400 }),
    );
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: false,
      details: { cause: "Unsupported video format or file" },
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("skips the retry when too little time is left", async () => {
    const upload = vi.fn(async () => Promise.reject({ message: "timeout", http_code: 499 }));
    const deadline = MIN_RETRY_BUDGET_MS;
    await expect(adapterWith(upload).copyVideoFromUrl(url, { deadline })).rejects.toMatchObject({
      retryable: true,
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("rejects a result without a duration", async () => {
    const upload = vi.fn(async () => uploaded({ duration: 0 }));
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: false,
      details: { reason: "missing-duration" },
    });
  });

  it.each([
    ["missing width", { width: 0 }],
    ["a non-integer width", { width: 1080.5 }],
    ["missing height", { height: 0 }],
    ["a negative height", { height: -1 }],
  ])("rejects a result with %s", async (_label, overrides) => {
    const upload = vi.fn(async () => uploaded(overrides));
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: false,
      details: { reason: "missing-dimensions" },
    });
  });

  it("rejects a result without a format", async () => {
    const upload = vi.fn(async () => uploaded({ format: "" }));
    await expect(adapterWith(upload).copyVideoFromUrl(url, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: false,
      details: { reason: "missing-format" },
    });
  });

  it("treats a sanity failure as retryable when the caller opts in", async () => {
    const upload = vi.fn(async () => uploaded({ duration: 0 }));
    await expect(
      adapterWith(upload).copyVideoFromUrl(url, {
        ...options,
        treatSanityFailureAsRetryable: true,
      }),
    ).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: true,
      details: { reason: "missing-duration" },
    });
  });
});
