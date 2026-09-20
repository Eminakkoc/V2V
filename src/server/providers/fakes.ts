import "server-only";
import { AppError } from "@/server/errors/app-error";
import { verifyWebhookSignature } from "./magic-hour-signature";
import type { Providers } from "./types";

export const FAKE_UUID_PREFIXES = { failsOnce: "f0000000-", unreadable: "e0000000-" } as const;
export const FAKE_FILE_SIZE = 5_242_880;
// Used only when the caller has no real webhook secret to hand in (e.g. plain unit
// tests). Deps wiring passes config.magicHour.webhookSecret so PROVIDER_MODE=fake
// e2e runs still exercise fail-closed verification against the configured secret.
const DEFAULT_FAKE_WEBHOOK_SECRET = "fake-webhook-secret";

function uuidFrom(url: string): string {
  return new URL(url).pathname.split("/")[1] ?? "";
}

export function createFakeProviders(
  cloudName: string,
  webhookSecret: string = DEFAULT_FAKE_WEBHOOK_SECRET,
): Providers {
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
    magicHour: {
      async createJob({ jobId }) {
        return { magicHourId: `fake-mh-${jobId}` };
      },
      async getJobDetails(magicHourId) {
        return {
          magicHourId,
          status: "complete",
          name: null,
          downloads: [
            { url: `https://fake.magichour.ai/${magicHourId}/output.mp4`, expiresAt: null },
          ],
          creditsCharged: 1,
          error: null,
        };
      },
      // Delegates to the real crypto so PROVIDER_MODE=fake still fails closed on a
      // bad signature instead of rubber-stamping every webhook delivery.
      verifyWebhook(args) {
        return verifyWebhookSignature({
          rawBody: args.rawBody,
          signature: args.signature,
          timestamp: args.timestamp,
          secret: webhookSecret,
          nowSeconds: args.nowSeconds ?? Math.floor(Date.now() / 1000),
        });
      },
    },
  };
}
