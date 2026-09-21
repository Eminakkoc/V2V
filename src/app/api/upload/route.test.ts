import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadResponseSchema } from "@/lib/upload-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import { AppError } from "@/server/errors/app-error";
import { createCloudinaryAdapter, type CloudinaryUpload } from "@/server/providers/cloudinary";
import type {
  MagicHourAdapter,
  Providers,
  UploadcareAdapter,
  UploadcareFileInfo,
} from "@/server/providers/types";
import { createJobsRepository } from "@/server/repositories/jobs";
import { createDbGetter } from "@/server/repositories/mongo-client";
import { createRateLimitHitsRepository } from "@/server/repositories/rate-limit-hits";
import { createRateLimiter } from "@/server/services/rate-limit";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { apiRequest, cookieValue, identityCookie } from "@/test/requests";
import { POST } from "./route";

const { getDb } = setupTestDb();
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const uuid = "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a";
const cdnUrl = `https://ucarecdn.com/${uuid}/`;

const fileInfo: UploadcareFileInfo = {
  uuid,
  mimeType: "video/quicktime",
  size: 1_000_000,
  originalFileUrl: `https://ucarecdn.com/${uuid}/beach.mov`,
  originalFilename: "beach.mov",
};

const stored = {
  public_id: "sources/abc",
  secure_url: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mov",
  format: "mov",
  bytes: 1_000_000,
  duration: 12.5,
  width: 1080,
  height: 1920,
};

let getFileInfo: ReturnType<typeof vi.fn<UploadcareAdapter["getFileInfo"]>>;
let cloudinaryUpload: ReturnType<typeof vi.fn<CloudinaryUpload>>;

const unusedMagicHour: MagicHourAdapter = {
  createJob: () => Promise.reject(new Error("unused")),
  getJobDetails: () => Promise.reject(new Error("unused")),
  verifyWebhook: () => {
    throw new Error("unused");
  },
};

function useDeps() {
  const providers: Providers = {
    uploadcare: { getFileInfo },
    cloudinary: createCloudinaryAdapter(testConfig.cloudinary, {
      upload: cloudinaryUpload,
      sleep: async () => {},
    }),
    magicHour: unusedMagicHour,
  };
  setServerDepsForTests(buildServerDeps(testConfig, { getDb, providers }));
}

const upload = (body: unknown = { cdnUrl }, init: { cookie?: string; rawBody?: string } = {}) =>
  POST(
    apiRequest("/api/upload", {
      body,
      cookie: init.cookie ?? identityCookie(userId),
      rawBody: init.rawBody,
    }),
  );

async function errorOf(response: Response) {
  return (await response.json()).error;
}

beforeEach(async () => {
  const db = await getDb();
  await Promise.all(
    ["sources", "jobs", "rateLimitHits"].map((name) => db.collection(name).deleteMany({})),
  );
  getFileInfo = vi.fn(async () => fileInfo);
  cloudinaryUpload = vi.fn(async () => stored);
  useDeps();
});
afterEach(() => setServerDepsForTests(undefined));

describe("POST /api/upload", () => {
  it("copies the file, saves the source for the caller and returns the contract", async () => {
    const response = await upload();
    expect(response.status).toBe(200);
    const body = uploadResponseSchema.parse(await response.json());
    expect(body.sourceVideo).toEqual({
      cloudinaryPublicId: "sources/abc",
      cloudinaryUrl: stored.secure_url,
      format: "mov",
      bytes: 1_000_000,
      duration: 12.5,
      width: 1080,
      height: 1920,
    });
    expect(body.posterUrl).toBe(
      "https://res.cloudinary.com/test-cloud/video/upload/so_0/sources/abc.jpg",
    );
    expect(cloudinaryUpload).toHaveBeenCalledWith(fileInfo.originalFileUrl, expect.anything());

    const db = await getDb();
    const saved = await db.collection("sources").findOne({});
    expect(saved).toMatchObject({ userId, uploadcareUuid: uuid, uploadcareCdnUrl: cdnUrl });
    expect(await db.collection("jobs").countDocuments()).toBe(0);
  });

  it("gives a first-time caller an identity cookie", async () => {
    const response = await POST(apiRequest("/api/upload", { body: { cdnUrl } }));
    expect(response.status).toBe(200);
    expect(cookieValue(response)).toBeDefined();
  });

  it.each([
    `http://ucarecdn.com/${uuid}/`,
    `https://evil.com/${uuid}/`,
    "https://ucarecdn.com/nope/",
  ])("rejects %s with 400 INVALID_VIDEO_URL", async (url) => {
    const response = await upload({ cdnUrl: url });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("INVALID_VIDEO_URL");
    expect(getFileInfo).not.toHaveBeenCalled();
  });

  it("rejects a missing cdnUrl with VALIDATION_FAILED", async () => {
    const response = await upload({});
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("rejects a file that is not in our Uploadcare project", async () => {
    getFileInfo.mockRejectedValueOnce(new AppError("INVALID_VIDEO_URL"));
    expect((await upload()).status).toBe(400);
  });

  it("rejects an unsupported format with 415 before copying", async () => {
    getFileInfo.mockResolvedValueOnce({ ...fileInfo, mimeType: "video/x-msvideo" });
    const response = await upload();
    expect(response.status).toBe(415);
    expect((await errorOf(response)).code).toBe("UNSUPPORTED_FORMAT");
    expect(cloudinaryUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversize file with 413", async () => {
    getFileInfo.mockResolvedValueOnce({ ...fileInfo, size: testConfig.upload.maxBytes + 1 });
    const response = await upload();
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("FILE_TOO_LARGE");
  });

  it("reports an Uploadcare outage as a retryable 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getFileInfo.mockRejectedValueOnce(new AppError("UPLOADCARE_FAILED", { retryable: true }));
    const response = await upload();
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatchObject({ code: "UPLOADCARE_FAILED", retryable: true });
  });

  it("recovers from one transient Cloudinary failure without a duplicate", async () => {
    cloudinaryUpload.mockRejectedValueOnce({ message: "Server error", http_code: 500 });
    const response = await upload();
    expect(response.status).toBe(200);
    expect(cloudinaryUpload).toHaveBeenCalledTimes(2);
    expect(cloudinaryUpload.mock.calls[0]?.[1].public_id).toBe(
      cloudinaryUpload.mock.calls[1]?.[1].public_id,
    );
    expect(await (await getDb()).collection("sources").countDocuments()).toBe(1);
  });

  it("returns a retryable 502 when both attempts fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cloudinaryUpload.mockRejectedValue({ message: "Server error", http_code: 503 });
    const response = await upload();
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: true,
    });
  });

  it("returns a non-retryable 502 for a file Cloudinary cannot decode", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cloudinaryUpload.mockRejectedValue({
      message: "Unsupported video format or file",
      http_code: 400,
    });
    const response = await upload();
    expect(await errorOf(response)).toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: false,
    });
    expect(cloudinaryUpload).toHaveBeenCalledTimes(1);
  });

  it("rate limits the 11th upload with Retry-After", async () => {
    for (let i = 0; i < 10; i += 1) expect((await upload()).status).toBe(200);
    const limited = await upload();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("rejects a body over 16 KB with 413 REQUEST_TOO_LARGE", async () => {
    const response = await upload(undefined, {
      rawBody: JSON.stringify({ cdnUrl: "x".repeat(17_000) }),
    });
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("REQUEST_TOO_LARGE");
  });

  it("reports our own bad write as a logged 500, not a client-facing 400", async () => {
    // A source our own server built badly must never surface as VALIDATION_FAILED, which would
    // blame the request and skip the log.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await getDb();
    setServerDepsForTests({
      config: testConfig,
      sources: {
        insert: async () => {
          throw new Error("Invalid sources document on write: bytes: Too small");
        },
        findById: async () => null,
        listForUser: async () => [],
        findByIds: async () => [],
      },
      jobs: createJobsRepository(() => Promise.resolve(db)),
      rateLimiter: createRateLimiter(createRateLimitHitsRepository(() => Promise.resolve(db))),
      uploadcare: { getFileInfo },
      cloudinary: createCloudinaryAdapter(testConfig.cloudinary, {
        upload: cloudinaryUpload,
        sleep: async () => {},
      }),
      magicHour: unusedMagicHour,
    });
    const response = await upload();
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toMatchObject({ code: "INTERNAL" });
    expect(log).toHaveBeenCalled();
  });

  it("answers 503 when the database is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unreachable = createDbGetter("mongodb://127.0.0.1:1", "v2v", {
      serverSelectionTimeoutMS: 200,
    });
    setServerDepsForTests(
      buildServerDeps(testConfig, {
        getDb: unreachable,
        providers: {
          uploadcare: { getFileInfo },
          cloudinary: { copyVideoFromUrl: vi.fn() },
          magicHour: unusedMagicHour,
        },
      }),
    );
    const response = await upload();
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      retryable: true,
    });
  });
});
