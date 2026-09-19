import "server-only";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary, type UploadApiOptions } from "cloudinary";
import { AppError, errorMessage } from "@/server/errors/app-error";
import type { CloudinaryAdapter, StoredVideo } from "./types";

export const SIZE_TOLERANCE = 0.01;
export const RETRY_DELAY_MS = 2_000;
export const MIN_RETRY_BUDGET_MS = 15_000;

type CloudinaryUploadResult = {
  public_id: string;
  secure_url: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  duration?: unknown;
};

export type CloudinaryUpload = (
  url: string,
  options: Record<string, unknown>,
) => Promise<CloudinaryUploadResult>;

type CloudinaryCredentials = { cloudName: string; apiKey: string; apiSecret: string };

type Runtime = {
  upload?: CloudinaryUpload;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultUpload: CloudinaryUpload = (url, options) =>
  cloudinary.uploader.upload(url, options as UploadApiOptions);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createCloudinaryAdapter(
  { cloudName, apiKey, apiSecret }: CloudinaryCredentials,
  { upload = defaultUpload, sleep = defaultSleep, now = Date.now }: Runtime = {},
): CloudinaryAdapter {
  return {
    async copyVideoFromUrl(url, { expectedBytes, deadline }) {
      const publicId = `sources/${randomUUID()}`;
      const attempt = () =>
        upload(url, {
          resource_type: "video",
          public_id: publicId,
          asset_folder: "sources",
          overwrite: true,
          timeout: Math.max(1, deadline - now()),
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
        });

      let result: CloudinaryUploadResult;
      try {
        result = await attempt();
      } catch (firstError) {
        // One retry, same public id, and only when a second attempt can still finish
        // inside the route's time budget.
        const budgetLeft = deadline - now() - RETRY_DELAY_MS;
        if (!isTransient(firstError) || budgetLeft < MIN_RETRY_BUDGET_MS) {
          throw toAppError(firstError);
        }
        await sleep(RETRY_DELAY_MS);
        result = await attempt().catch((secondError: unknown) => {
          throw toAppError(secondError);
        });
      }
      return toStoredVideo(result, expectedBytes);
    },
  };
}

function httpCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "http_code" in error) {
    return typeof error.http_code === "number" ? error.http_code : undefined;
  }
  return undefined;
}

function isTransient(error: unknown): boolean {
  const code = httpCode(error);
  return code === undefined || code === 420 || code === 429 || code === 499 || code >= 500;
}

function toAppError(error: unknown): AppError {
  return new AppError("CLOUDINARY_UPLOAD_FAILED", {
    retryable: isTransient(error),
    cause: error,
    details: { cause: errorMessage(error) },
  });
}

function toStoredVideo(result: CloudinaryUploadResult, expectedBytes: number): StoredVideo {
  const duration = typeof result.duration === "number" ? result.duration : 0;
  if (duration <= 0) throw sanityFailure({ reason: "missing-duration" });
  if (Math.abs(result.bytes - expectedBytes) > SIZE_TOLERANCE * expectedBytes) {
    throw sanityFailure({ reason: "size-mismatch", expectedBytes, actualBytes: result.bytes });
  }
  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    format: result.format,
    bytes: result.bytes,
    duration,
    width: result.width,
    height: result.height,
  };
}

function sanityFailure(details: Record<string, unknown>): AppError {
  return new AppError("CLOUDINARY_UPLOAD_FAILED", {
    message: "This file can't be processed. Try a different video.",
    retryable: false,
    details,
  });
}
