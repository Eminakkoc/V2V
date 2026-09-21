import "server-only";
import { fileInfo, isRestClientError, UploadcareSimpleAuthSchema } from "@uploadcare/rest-client";
import { AppError, errorMessage } from "@/server/errors/app-error";
import type { UploadcareAdapter } from "./types";

type UploadcareKeys = { publicKey: string; secretKey: string };

export function createUploadcareAdapter(
  { publicKey, secretKey }: UploadcareKeys,
  fetchFileInfo: typeof fileInfo = fileInfo,
): UploadcareAdapter {
  const authSchema = new UploadcareSimpleAuthSchema({ publicKey, secretKey });
  return {
    async getFileInfo(uuid) {
      // Bounded to one retry each, so a single call cannot eat into the route's Cloudinary copy
      // budget before we ever see it fail.
      const info = await fetchFileInfo(
        { uuid },
        { authSchema, retryThrottledRequestMaxTimes: 1, retryNetworkErrorMaxTimes: 1 },
      ).catch((error: unknown) => {
        throw toAppError(error);
      });
      if (!info.isReady || !info.originalFileUrl) {
        throw new AppError("UPLOADCARE_FAILED", {
          message: "Your upload is still being processed. Try again in a moment.",
          retryable: true,
        });
      }
      return {
        uuid: info.uuid,
        // mimeType only echoes the Content-Type the uploading client sent, so prefer the sniffed
        // contentInfo type; the filename is the last resort.
        mimeType: info.contentInfo?.mime?.mime || info.mimeType,
        size: info.size,
        originalFileUrl: info.originalFileUrl,
        originalFilename: info.originalFilename,
      };
    },
  };
}

function toAppError(error: unknown): AppError {
  const status = isRestClientError(error) ? error.status : undefined;
  if (status === 404) return new AppError("INVALID_VIDEO_URL", { cause: error });
  const retryable = status === undefined || status === 429 || status >= 500;
  return new AppError("UPLOADCARE_FAILED", {
    retryable,
    cause: error,
    details: { cause: errorMessage(error) },
  });
}
