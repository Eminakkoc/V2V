import "server-only";
import { AppError } from "@/server/errors/app-error";
import { verifyWebhookSignature } from "./magic-hour-signature";
import type { ProviderStatus } from "./magic-hour-mapping";
import type { Providers } from "./types";

export const FAKE_UUID_PREFIXES = {
  failsOnce: "f0000000-",
  unreadable: "e0000000-",
  longSource: "d0000000-",
  oddSource: "c0000000-",
} as const;
export const FAKE_FILE_SIZE = 5_242_880;
export const FAKE_SOURCE_SECONDS = 12.5;
// Longer than MAX_CLIP_SECONDS (30), so the clip-length cap binds before the source-duration check.
export const FAKE_LONG_SOURCE_SECONDS = 60;
// More than two decimals, so the client half of the two-decimal rule is reachable under
// PROVIDER_MODE=fake.
export const FAKE_ODD_SOURCE_SECONDS = 2.69973;

// Substring opt-ins a caller writes into the job name to steer the fake adapter down branches that
// have no other trigger under PROVIDER_MODE=fake.
export const FAKE_JOB_NAME_TRIGGERS = {
  // An *uncertain* failure: no magicHourId, which is the only state the webhook's name fallback can
  // recover from.
  createUncertain: "fake:create-uncertain",
  // The Cloudinary copy fails retryably once, then succeeds -- the transient branch that keeps a
  // paid render recoverable on redelivery.
  copyFailsOnce: "fake:copy-fails-once",
  // The copy fails permanently -- the branch that marks the job failed rather than inviting another
  // delivery.
  copyUnreadable: "fake:copy-unreadable",
  // Reconciliation calls getJobDetails with nothing but the id, so a wanted status has to be
  // encoded into it at create time.
  statusRendering: "fake:status-rendering",
  statusError: "fake:status-error",
  statusCanceled: "fake:status-canceled",
} as const;

const FAKE_MH_PREFIX = "fake-mh-";
const STATUS_TAG = "~s=";
// Only for callers with no real webhook secret; deps wiring passes the configured one so fake-mode
// e2e still verifies fail-closed.
const DEFAULT_FAKE_WEBHOOK_SECRET = "fake-webhook-secret";

function uuidFrom(url: string): string {
  return new URL(url).pathname.split("/")[1] ?? "";
}

function copyPrefixFor(jobName: string): string {
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.copyUnreadable)) {
    return FAKE_UUID_PREFIXES.unreadable;
  }
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.copyFailsOnce)) {
    return FAKE_UUID_PREFIXES.failsOnce;
  }
  return "";
}

function statusTagFor(jobName: string): string {
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.statusRendering)) return "rendering";
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.statusError)) return "error";
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.statusCanceled)) return "canceled";
  return "";
}

// Both triggers ride on the id because getJobDetails is handed nothing else; the status tag trails
// it so the copy prefix stays the first path segment of the download URL.
export function fakeMagicHourId(jobId: string, copyPrefix = "", statusTag = ""): string {
  const tail = statusTag ? `${STATUS_TAG}${statusTag}` : "";
  return `${FAKE_MH_PREFIX}${copyPrefix}${jobId}${tail}`;
}

// Stripping FAKE_MH_PREFIX puts the trigger prefix first, where the fake Cloudinary adapter reads
// its failure mode; the remainder stays unique per job.
function downloadSegment(magicHourId: string): string {
  return magicHourId.startsWith(FAKE_MH_PREFIX)
    ? magicHourId.slice(FAKE_MH_PREFIX.length)
    : magicHourId;
}

// With no trigger this must report "complete" -- every shipped e2e spec depends on that default.
function statusFromId(magicHourId: string): ProviderStatus {
  const index = magicHourId.indexOf(STATUS_TAG);
  if (index === -1) return "complete";
  const tag = magicHourId.slice(index + STATUS_TAG.length);
  return tag === "rendering" || tag === "error" || tag === "canceled" ? tag : "complete";
}

// The two statuses mapProviderStatus reports as "failed" carry a reason, so the fake must populate
// one or those branches are unreachable.
function errorFor(status: ProviderStatus): { code: string; message: string } | null {
  if (status === "error") {
    return { code: "fake_render_error", message: "The fake provider reported a render error." };
  }
  if (status === "canceled") {
    return {
      code: "fake_render_canceled",
      message: "The fake provider reported a canceled render.",
    };
  }
  return null;
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
      async copyVideoFromUrl(url, { folder }) {
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
        const publicId = `${folder}/fake-${uuid}`;
        return {
          publicId,
          secureUrl: `https://res.cloudinary.com/${cloudName}/video/upload/${publicId}.mp4`,
          format: "mp4",
          bytes: FAKE_FILE_SIZE,
          duration: uuid.startsWith(FAKE_UUID_PREFIXES.longSource)
            ? FAKE_LONG_SOURCE_SECONDS
            : uuid.startsWith(FAKE_UUID_PREFIXES.oddSource)
              ? FAKE_ODD_SOURCE_SECONDS
              : FAKE_SOURCE_SECONDS,
          width: 1280,
          height: 720,
        };
      },
    },
    magicHour: {
      async createJob({ jobId, params }) {
        if (params.name.includes(FAKE_JOB_NAME_TRIGGERS.createUncertain)) {
          // definite: false is the whole point: startTransform must leave the job submitting with
          // no magicHourId, not mark it failed.
          throw new AppError("MAGIC_HOUR_REQUEST_FAILED", { details: { definite: false } });
        }
        return {
          magicHourId: fakeMagicHourId(
            jobId,
            copyPrefixFor(params.name),
            statusTagFor(params.name),
          ),
        };
      },
      async getJobDetails(magicHourId) {
        const status = statusFromId(magicHourId);
        return {
          magicHourId,
          status,
          name: null,
          downloads: [
            {
              url: `https://fake.magichour.ai/${downloadSegment(magicHourId)}/output.mp4`,
              expiresAt: null,
            },
          ],
          creditsCharged: 1,
          error: errorFor(status),
        };
      },
      // Delegates to the real crypto so PROVIDER_MODE=fake still fails closed on a bad signature.
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
