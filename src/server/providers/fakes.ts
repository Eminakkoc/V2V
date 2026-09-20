import "server-only";
import { AppError } from "@/server/errors/app-error";
import type { Providers } from "./types";

export const FAKE_UUID_PREFIXES = { failsOnce: "f0000000-", unreadable: "e0000000-" } as const;
export const FAKE_FILE_SIZE = 5_242_880;

function uuidFrom(url: string): string {
  return new URL(url).pathname.split("/")[1] ?? "";
}

export function createFakeProviders(cloudName: string): Providers {
  const failedOnce = new Set<string>();
  return {
    uploadcare: {
      async getFileInfo(uuid) {
        return {
          uuid,
          mimeType: "video/mp4",
          size: FAKE_FILE_SIZE,
          originalFileUrl: `https://fake.ucarecd.net/${uuid}/`,
          originalFilename: "clip.mp4",
        };
      },
    },
    cloudinary: {
      async copyVideoFromUrl(url) {
        const uuid = uuidFrom(url);
        if (uuid.startsWith(FAKE_UUID_PREFIXES.unreadable)) {
          throw new AppError("CLOUDINARY_UPLOAD_FAILED", {
            retryable: false,
            details: { cause: "Unsupported video format or file" },
          });
        }
        if (uuid.startsWith(FAKE_UUID_PREFIXES.failsOnce) && !failedOnce.has(uuid)) {
          failedOnce.add(uuid);
          throw new AppError("CLOUDINARY_UPLOAD_FAILED", { retryable: true });
        }
        const publicId = `sources/fake-${uuid}`;
        return {
          publicId,
          secureUrl: `https://res.cloudinary.com/${cloudName}/video/upload/${publicId}.mp4`,
          format: "mp4",
          bytes: FAKE_FILE_SIZE,
          duration: 12.5,
          width: 1280,
          height: 720,
        };
      },
    },
  };
}
