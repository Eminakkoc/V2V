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
      const info = await fetchFileInfo({ uuid }, { authSchema }).catch((error: unknown) => {
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
        mimeType: info.mimeType,
        size: info.size,
        originalFileUrl: info.originalFileUrl,
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
