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
// Long enough that MAX_CLIP_SECONDS (30) binds before the source-duration
// check in startTransform. Without a source longer than the cap, that branch
// is unreachable and the cap is untestable through the real route.
export const FAKE_LONG_SOURCE_SECONDS = 60;
// More than two decimals, which is what a real source reports and what
// transformParamsSchema refuses. Both durations above are already two-decimal
// figures, so under PROVIDER_MODE=fake the trimmer could not produce an
// out-of-spec value at all and the client half of the two-decimal rule was
// unreachable by the suite.
export const FAKE_ODD_SOURCE_SECONDS = 2.69973;

// Opt-ins a caller writes into the job name (params.name) to steer the fake
// Magic Hour adapter down a branch it would otherwise never take. They exist
// because several real-world outcomes have no other trigger under
// PROVIDER_MODE=fake: the fake createJob always succeeds, and the download URL
// it hands finalize is keyed on the Magic Hour id, never on anything the
// caller controls. Matching is substring-based so a trigger can sit inside an
// otherwise ordinary name. Read only here; PROVIDER_MODE=real never sees them.
export const FAKE_JOB_NAME_TRIGGERS = {
  // createJob reports an *uncertain* failure: the job stays processing/
  // submitting with no magicHourId, which is the only state the webhook's
  // v2v:<jobId> name fallback can recover from.
  createUncertain: "fake:create-uncertain",
  // finalize's Cloudinary copy fails retryably once, then succeeds — the
  // transient branch that releases the claim, answers 500 and keeps the paid
  // render recoverable on redelivery.
  copyFailsOnce: "fake:copy-fails-once",
  // finalize's Cloudinary copy fails permanently — the branch that markFailed's
  // the job rather than inviting another delivery.
  copyUnreadable: "fake:copy-unreadable",
  // Reconciliation calls getJobDetails with nothing but the id, so a status
  // the caller wants reported has to be encoded into that id at create time.
  statusRendering: "fake:status-rendering",
  statusError: "fake:status-error",
  statusCanceled: "fake:status-canceled",
} as const;

const FAKE_MH_PREFIX = "fake-mh-";
const STATUS_TAG = "~s=";
// Used only when the caller has no real webhook secret to hand in (e.g. plain unit
// tests). Deps wiring passes config.magicHour.webhookSecret so PROVIDER_MODE=fake
// e2e runs still exercise fail-closed verification against the configured secret.
const DEFAULT_FAKE_WEBHOOK_SECRET = "fake-webhook-secret";

function uuidFrom(url: string): string {
  return new URL(url).pathname.split("/")[1] ?? "";
}

// The Cloudinary trigger, if any, that a job name asks finalize's copy to hit.
function copyPrefixFor(jobName: string): string {
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.copyUnreadable)) {
    return FAKE_UUID_PREFIXES.unreadable;
  }
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.copyFailsOnce)) {
    return FAKE_UUID_PREFIXES.failsOnce;
  }
  return "";
}

// The status trigger, if any, that a job name asks getJobDetails to report.
function statusTagFor(jobName: string): string {
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.statusRendering)) return "rendering";
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.statusError)) return "error";
  if (jobName.includes(FAKE_JOB_NAME_TRIGGERS.statusCanceled)) return "canceled";
  return "";
}

// The fake Magic Hour id is the carrier for both triggers: getJobDetails is
// handed nothing but the id, so createJob encodes the caller's choices into it
// rather than keeping per-process state that a server restart would lose.
// The status tag trails the id rather than leading it, because the copy
// prefix has to stay the FIRST path segment of the download URL, which is
// where the fake Cloudinary adapter reads its failure mode.
export function fakeMagicHourId(jobId: string, copyPrefix = "", statusTag = ""): string {
  const tail = statusTag ? `${STATUS_TAG}${statusTag}` : "";
  return `${FAKE_MH_PREFIX}${copyPrefix}${jobId}${tail}`;
}

// The first path segment of the download URL is exactly what the fake
// Cloudinary adapter reads its failure mode from, so the trigger prefix has to
// lead it. Stripping FAKE_MH_PREFIX is what puts it there; the remainder stays
// unique per job, which keeps the fails-once bookkeeping per-job. The trailing
// status tag (if any) rides along harmlessly -- nothing downstream parses this
// URL as anything but an opaque path.
function downloadSegment(magicHourId: string): string {
  return magicHourId.startsWith(FAKE_MH_PREFIX)
    ? magicHourId.slice(FAKE_MH_PREFIX.length)
    : magicHourId;
}

// With no trigger this must report "complete" -- every shipped e2e spec
// depends on that default.
function statusFromId(magicHourId: string): ProviderStatus {
  const index = magicHourId.indexOf(STATUS_TAG);
  if (index === -1) return "complete";
  const tag = magicHourId.slice(index + STATUS_TAG.length);
  return tag === "rendering" || tag === "error" || tag === "canceled" ? tag : "complete";
}

// A populated error object for the two statuses whose mapping carries a
// reason (mapProviderStatus's "failed" branches) -- otherwise those
// reason-carrying branches (failureMessage's provider-message fallback,
// markFailedFromCheck's magicHourError) would be unreachable through the fake.
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
        // Mirrors the real adapter's `<folder>/<id>`: a fake that always said
        // "sources" is what let the misfiled results through D.1's green path.
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
          // definite: false is the whole point — startTransform must leave the
          // job processing/submitting with no magicHourId, not mark it failed.
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
