import { describe, expect, it, vi } from "vitest";
import type { CopyVideoOptions, StoredVideo, UploadcareFileInfo } from "@/server/providers/types";
import type { Source } from "@/server/repositories/sources";
import { testConfig } from "@/test/env";
import { COPY_BUDGET_MS, parseUploadcareCdnUrl, uploadSource } from "./upload-source";

const uuid = "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a";

describe("parseUploadcareCdnUrl", () => {
  it.each([
    `https://ucarecdn.com/${uuid}/`,
    `https://ucarecdn.com/${uuid}/beach.mov`,
    `https://abc123xyz.ucarecd.net/${uuid}/`,
    `https://ucarecdn.com/${uuid.toUpperCase()}/-/preview/`,
  ])("accepts %s", (url) => {
    expect(parseUploadcareCdnUrl(url).uuid).toBe(uuid);
  });

  it.each([
    `http://ucarecdn.com/${uuid}/`,
    `https://evil.com/${uuid}/`,
    `https://ucarecdn.com.evil.com/${uuid}/`,
    `https://user:pass@ucarecdn.com/${uuid}/`,
    `https://ucarecdn.com:8443/${uuid}/`,
    "https://ucarecdn.com/not-a-uuid/",
    "not a url",
  ])("rejects %s with INVALID_VIDEO_URL", (url) => {
    let caught: unknown;
    try {
      parseUploadcareCdnUrl(url);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "INVALID_VIDEO_URL" });
  });
});

describe("uploadSource", () => {
  it("anchors the copy deadline at the start of the request, not after getFileInfo", async () => {
    let now = 0;
    const clock = () => now;
    const fileInfo: UploadcareFileInfo = {
      uuid,
      mimeType: "video/mp4",
      size: 1_000,
      originalFileUrl: `https://ucarecdn.com/${uuid}/clip.mp4`,
      originalFilename: "clip.mp4",
    };
    const storedVideo: StoredVideo = {
      publicId: "sources/abc",
      secureUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mp4",
      format: "mp4",
      bytes: 1_000,
      duration: 5,
      width: 640,
      height: 360,
    };
    const getFileInfo = vi.fn(async (): Promise<UploadcareFileInfo> => {
      now += 20_000;
      return fileInfo;
    });
    let seenDeadline: number | undefined;
    const copyVideoFromUrl = vi.fn(async (_url: string, options: CopyVideoOptions) => {
      seenDeadline = options.deadline;
      return storedVideo;
    });
    const insert = vi.fn(
      async (userId: string, input: Record<string, unknown>): Promise<Source> =>
        ({
          id: "s1",
          userId,
          schemaVersion: 1,
          createdAt: new Date(),
          ...input,
        }) as Source,
    );

    await uploadSource(
      { cdnUrl: `https://ucarecdn.com/${uuid}/` },
      "user-1",
      {
        config: testConfig,
        uploadcare: { getFileInfo },
        cloudinary: { copyVideoFromUrl },
        sources: { insert, findById: vi.fn(), listForUser: vi.fn(), findByIds: vi.fn() },
      },
      clock,
    );

    expect(seenDeadline).toBe(COPY_BUDGET_MS);
  });

  it("stores the CDN URL on the host of Uploadcare's own file info, not the host the client sent", async () => {
    const fileInfo: UploadcareFileInfo = {
      uuid,
      mimeType: "video/mp4",
      size: 1_000,
      originalFileUrl: `https://cdn123.ucarecd.net/${uuid}/clip.mp4`,
      originalFilename: "clip.mp4",
    };
    const storedVideo: StoredVideo = {
      publicId: "sources/abc",
      secureUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mp4",
      format: "mp4",
      bytes: 1_000,
      duration: 5,
      width: 640,
      height: 360,
    };
    let savedCdnUrl: unknown;
    const insert = vi.fn(
      async (userId: string, input: Record<string, unknown>): Promise<Source> => {
        savedCdnUrl = input.uploadcareCdnUrl;
        return {
          id: "s1",
          userId,
          schemaVersion: 1,
          createdAt: new Date(),
          ...input,
        } as Source;
      },
    );

    await uploadSource({ cdnUrl: `https://ucarecdn.com/${uuid}/` }, "user-1", {
      config: testConfig,
      uploadcare: { getFileInfo: vi.fn(async () => fileInfo) },
      cloudinary: { copyVideoFromUrl: vi.fn(async () => storedVideo) },
      sources: { insert, findById: vi.fn(), listForUser: vi.fn(), findByIds: vi.fn() },
    });

    expect(savedCdnUrl).toBe(`https://cdn123.ucarecd.net/${uuid}/`);
  });

  it("accepts a file whose recorded type is generic by falling back to its filename", async () => {
    // Uploadcare records "application/octet-stream" when the uploading client declared no content
    // type; the server must still accept it on the file name.
    const fileInfo: UploadcareFileInfo = {
      uuid,
      mimeType: "application/octet-stream",
      size: 1_000,
      originalFileUrl: `https://ucarecdn.com/${uuid}/small.mov`,
      originalFilename: "small.mov",
    };
    const storedVideo: StoredVideo = {
      publicId: "sources/abc",
      secureUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mov",
      format: "mov",
      bytes: 1_000,
      duration: 5,
      width: 640,
      height: 360,
    };
    const insert = vi.fn(
      async (userId: string, input: Record<string, unknown>): Promise<Source> =>
        ({ id: "s1", userId, schemaVersion: 1, createdAt: new Date(), ...input }) as Source,
    );

    await expect(
      uploadSource({ cdnUrl: `https://ucarecdn.com/${uuid}/` }, "user-1", {
        config: testConfig,
        uploadcare: { getFileInfo: vi.fn(async () => fileInfo) },
        cloudinary: { copyVideoFromUrl: vi.fn(async () => storedVideo) },
        sources: { insert, findById: vi.fn(), listForUser: vi.fn(), findByIds: vi.fn() },
      }),
    ).resolves.toMatchObject({ sourceId: "s1" });
  });

  it("still rejects a generic type whose filename is not a supported video", async () => {
    const fileInfo: UploadcareFileInfo = {
      uuid,
      mimeType: "application/octet-stream",
      size: 1_000,
      originalFileUrl: `https://ucarecdn.com/${uuid}/notes.pdf`,
      originalFilename: "notes.pdf",
    };

    await expect(
      uploadSource({ cdnUrl: `https://ucarecdn.com/${uuid}/` }, "user-1", {
        config: testConfig,
        uploadcare: { getFileInfo: vi.fn(async () => fileInfo) },
        cloudinary: { copyVideoFromUrl: vi.fn() },
        sources: { insert: vi.fn(), findById: vi.fn(), listForUser: vi.fn(), findByIds: vi.fn() },
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });
});
