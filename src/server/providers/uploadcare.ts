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
      // The rest-client retries throttled and network errors on its own; bounded
      // to one retry each so a single call cannot eat into the route's own
      // Cloudinary copy budget (COPY_BUDGET_MS) before we ever see it fail.
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
        // Uploadcare reports the type twice: `mimeType` echoes the Content-Type
        // the uploading client sent — "application/octet-stream" whenever it
        // sent none — while contentInfo.mime.mime is sniffed from the bytes.
        // Prefer the sniffed one; the filename is the last resort, applied by
        // the shared video rules.
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
