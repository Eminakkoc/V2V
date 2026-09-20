import { describe, expect, it } from "vitest";
import type { TransformParams } from "@/lib/transform-contract";
import { createFakeProviders, FAKE_FILE_SIZE } from "./fakes";

const plain = "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a";
const failsOnce = "f0000000-0000-4000-8000-000000000001";
const unreadable = "e0000000-0000-4000-8000-000000000001";
const options = { deadline: Date.now() + 50_000 };

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
});
