import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
// Not "@/...": the point is pinning e2e/helpers.ts's copy of this vocabulary against the server's.
import { fakeMagicHourId as e2eFakeMagicHourId } from "../../../e2e/helpers";
import type { TransformParams } from "@/lib/transform-contract";
import {
  createFakeProviders,
  fakeMagicHourId,
  FAKE_FILE_SIZE,
  FAKE_JOB_NAME_TRIGGERS,
  FAKE_LONG_SOURCE_SECONDS,
  FAKE_SOURCE_SECONDS,
  FAKE_UUID_PREFIXES,
} from "./fakes";
import { CLOUDINARY_FOLDERS } from "./types";

const plain = "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a";
const failsOnce = "f0000000-0000-4000-8000-000000000001";
const unreadable = "e0000000-0000-4000-8000-000000000001";
const longSource = "d0000000-0000-4000-8000-000000000001";
const jobId = "65f000000000000000000001";
const options = { deadline: Date.now() + 50_000, folder: CLOUDINARY_FOLDERS.sources } as const;

const fakeParams: TransformParams = {
  name: "beach clip",
  startSeconds: 0,
  endSeconds: 5,
  fpsResolution: "HALF",
  artStyle: "Watercolor",
  promptType: "default",
  model: "default",
  version: "default",
};

describe("fake providers", () => {
  it("returns ready file info and a stored video", async () => {
    const { uploadcare, cloudinary } = createFakeProviders("demo");
    const info = await uploadcare.getFileInfo(plain);
    expect(info).toMatchObject({ uuid: plain, mimeType: "video/mp4", size: FAKE_FILE_SIZE });
    await expect(cloudinary.copyVideoFromUrl(info.originalFileUrl, options)).resolves.toMatchObject(
      {
        publicId: `sources/fake-${plain}`,
        bytes: FAKE_FILE_SIZE,
      },
    );
  });

  it("fails once, then succeeds, for the fails-once prefix", async () => {
    const { uploadcare, cloudinary } = createFakeProviders("demo");
    const { originalFileUrl } = await uploadcare.getFileInfo(failsOnce);
    await expect(cloudinary.copyVideoFromUrl(originalFileUrl, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: true,
    });
    await expect(cloudinary.copyVideoFromUrl(originalFileUrl, options)).resolves.toBeDefined();
  });

  it("always fails for the unreadable prefix", async () => {
    const { uploadcare, cloudinary } = createFakeProviders("demo");
    const { originalFileUrl } = await uploadcare.getFileInfo(unreadable);
    await expect(cloudinary.copyVideoFromUrl(originalFileUrl, options)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("provides a Magic Hour fake that returns a deterministic id and a download", async () => {
    const { magicHour } = createFakeProviders("test-cloud");
    const { magicHourId } = await magicHour.createJob({
      jobId: "65f000000000000000000001",
      videoUrl: "https://example.test/in.mp4",
      params: fakeParams,
    });
    expect(magicHourId).toMatch(/^fake-mh-/);
    const details = await magicHour.getJobDetails(magicHourId);
    expect(details.status).toBe("complete");
    expect(details.downloads[0]?.url).toMatch(/^https:/);
  });

  it("reports the default source duration, and a longer one for the long-source prefix", async () => {
    const { uploadcare, cloudinary } = createFakeProviders("demo");
    const plainInfo = await uploadcare.getFileInfo(plain);
    await expect(
      cloudinary.copyVideoFromUrl(plainInfo.originalFileUrl, options),
    ).resolves.toMatchObject({ duration: FAKE_SOURCE_SECONDS });

    // Without a source longer than MAX_CLIP_SECONDS the clip-length cap is unreachable -- the
    // source-duration check binds first.
    const longInfo = await uploadcare.getFileInfo(longSource);
    await expect(
      cloudinary.copyVideoFromUrl(longInfo.originalFileUrl, options),
    ).resolves.toMatchObject({ duration: FAKE_LONG_SOURCE_SECONDS });
  });

  it("reports an uncertain createJob failure when the job name asks for one", async () => {
    const { magicHour } = createFakeProviders("test-cloud");
    await expect(
      magicHour.createJob({
        jobId,
        videoUrl: "https://example.test/in.mp4",
        params: { ...fakeParams, name: `beach ${FAKE_JOB_NAME_TRIGGERS.createUncertain}` },
      }),
    ).rejects.toMatchObject({
      code: "MAGIC_HOUR_REQUEST_FAILED",
      details: { definite: false },
    });
  });

  it.each([
    [FAKE_JOB_NAME_TRIGGERS.copyFailsOnce, FAKE_UUID_PREFIXES.failsOnce, true],
    [FAKE_JOB_NAME_TRIGGERS.copyUnreadable, FAKE_UUID_PREFIXES.unreadable, false],
  ])(
    "routes the finalize download URL through the %s Cloudinary trigger",
    async (trigger, prefix, retryable) => {
      const { magicHour, cloudinary } = createFakeProviders("test-cloud");
      const { magicHourId } = await magicHour.createJob({
        jobId,
        videoUrl: "https://example.test/in.mp4",
        params: { ...fakeParams, name: `beach ${trigger}` },
      });
      const details = await magicHour.getJobDetails(magicHourId);
      const url = details.downloads[0]?.url ?? "";

      // The fake Cloudinary reads its failure mode from the first path segment, so the trigger
      // prefix has to lead it.
      expect(new URL(url).pathname.split("/")[1]?.startsWith(prefix)).toBe(true);
      await expect(cloudinary.copyVideoFromUrl(url, options)).rejects.toMatchObject({
        code: "CLOUDINARY_UPLOAD_FAILED",
        retryable,
      });
    },
  );

  it("hands an untriggered finalize download URL straight through to a successful copy", async () => {
    const { magicHour, cloudinary } = createFakeProviders("test-cloud");
    const { magicHourId } = await magicHour.createJob({
      jobId,
      videoUrl: "https://example.test/in.mp4",
      params: fakeParams,
    });
    const details = await magicHour.getJobDetails(magicHourId);
    await expect(
      cloudinary.copyVideoFromUrl(details.downloads[0]?.url ?? "", options),
    ).resolves.toBeDefined();
  });

  it.each([
    [FAKE_JOB_NAME_TRIGGERS.statusRendering, "rendering"],
    [FAKE_JOB_NAME_TRIGGERS.statusError, "error"],
    [FAKE_JOB_NAME_TRIGGERS.statusCanceled, "canceled"],
  ] as const)(
    "reports %s as the %s status, with a populated error where the mapping expects one",
    async (trigger, status) => {
      const { magicHour } = createFakeProviders("test-cloud");
      const { magicHourId } = await magicHour.createJob({
        jobId,
        videoUrl: "https://example.test/in.mp4",
        params: { ...fakeParams, name: `beach ${trigger}` },
      });
      expect(magicHourId).toBe(`fake-mh-${jobId}~s=${status}`);

      const details = await magicHour.getJobDetails(magicHourId);
      expect(details.status).toBe(status);
      if (status === "rendering") {
        expect(details.error).toBeNull();
      } else {
        expect(details.error).toMatchObject({
          code: expect.any(String),
          message: expect.any(String),
        });
      }
    },
  );

  it("reports complete with no error when the job name carries no status trigger", async () => {
    const { magicHour } = createFakeProviders("test-cloud");
    const { magicHourId } = await magicHour.createJob({
      jobId,
      videoUrl: "https://example.test/in.mp4",
      params: fakeParams,
    });
    const details = await magicHour.getJobDetails(magicHourId);
    expect(details.status).toBe("complete");
    expect(details.error).toBeNull();
  });

  // A name carrying both triggers must keep the copy prefix leading the download URL; the trailing
  // status tag must not displace it.
  it("keeps the copy-fails-once prefix leading the download URL even when a status trigger is also present", async () => {
    const { magicHour, cloudinary } = createFakeProviders("test-cloud");
    const { magicHourId } = await magicHour.createJob({
      jobId,
      videoUrl: "https://example.test/in.mp4",
      params: {
        ...fakeParams,
        name: `beach ${FAKE_JOB_NAME_TRIGGERS.copyFailsOnce} ${FAKE_JOB_NAME_TRIGGERS.statusRendering}`,
      },
    });
    expect(magicHourId).toBe(`fake-mh-${FAKE_UUID_PREFIXES.failsOnce}${jobId}~s=rendering`);

    const details = await magicHour.getJobDetails(magicHourId);
    expect(details.status).toBe("rendering");
    const url = details.downloads[0]?.url ?? "";
    expect(new URL(url).pathname.split("/")[1]?.startsWith(FAKE_UUID_PREFIXES.failsOnce)).toBe(
      true,
    );
    await expect(cloudinary.copyVideoFromUrl(url, options)).rejects.toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: true,
    });
  });

  it("keeps e2e/helpers.ts's fakeMagicHourId byte-identical to the server's for the same arguments", () => {
    expect(e2eFakeMagicHourId(jobId)).toBe(fakeMagicHourId(jobId));
    expect(e2eFakeMagicHourId(jobId, FAKE_UUID_PREFIXES.failsOnce)).toBe(
      fakeMagicHourId(jobId, FAKE_UUID_PREFIXES.failsOnce),
    );
    expect(e2eFakeMagicHourId(jobId, "", "rendering")).toBe(
      fakeMagicHourId(jobId, "", "rendering"),
    );
    expect(e2eFakeMagicHourId(jobId, FAKE_UUID_PREFIXES.failsOnce, "rendering")).toBe(
      fakeMagicHourId(jobId, FAKE_UUID_PREFIXES.failsOnce, "rendering"),
    );
  });

  // If the fake's verifyWebhook were ever simplified to `return true`, every webhook security test
  // would still pass while the real protection was gone.
  it("verifyWebhook rejects a bad signature and accepts one signed with its own secret", () => {
    const secret = "a-specific-fake-secret";
    const { magicHour } = createFakeProviders("test-cloud", secret);
    const rawBody = JSON.stringify({ type: "video.completed", payload: { id: "fake-mh-1" } });
    const nowSeconds = 1_758_000_000;
    const timestamp = String(nowSeconds);
    const goodSignature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    expect(
      magicHour.verifyWebhook({
        rawBody,
        signature: "0".repeat(goodSignature.length),
        timestamp,
        nowSeconds,
      }),
    ).toEqual({ ok: false, code: "WEBHOOK_INVALID_SIGNATURE" });

    expect(
      magicHour.verifyWebhook({ rawBody, signature: goodSignature, timestamp, nowSeconds }),
    ).toEqual({ ok: true });
  });

  it("honours the requested folder, so a fake run can tell a result from a source", async () => {
    const { uploadcare, cloudinary } = createFakeProviders("demo");
    const { originalFileUrl } = await uploadcare.getFileInfo(plain);
    await expect(
      cloudinary.copyVideoFromUrl(originalFileUrl, {
        deadline: Date.now() + 50_000,
        folder: CLOUDINARY_FOLDERS.results,
      }),
    ).resolves.toMatchObject({ publicId: `results/fake-${plain}` });
  });
});
