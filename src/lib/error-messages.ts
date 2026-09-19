import { describeFormats, formatBytes } from "./format";

export type ErrorLike = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
};

export type ErrorAction = "retry" | "choose-another-file" | "wait" | "wait-retry" | "none";

export type ErrorMessage = { title: string; description: string; action: ErrorAction };

export type UploadLimits = { maxBytes: number; allowedFormats: readonly string[] };

// Before anything has uploaded (rejected) there is no cdnUrl to retry, and once bytes
// are stored (failed) a rate limit can offer a timed retry instead of a plain wait.
export type MessageStage = "rejected" | "failed";

function seconds(value: number): string {
  return value === 1 ? "1 second" : `${value} seconds`;
}

function waitCopy(retryAfterSeconds: number): string {
  if (retryAfterSeconds < 60) return seconds(retryAfterSeconds);
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function messageFor(
  error: ErrorLike,
  limits: UploadLimits,
  options?: { stage?: MessageStage },
): ErrorMessage {
  const message = baseMessageFor(error, limits);
  if (options?.stage === "rejected" && message.action === "retry") {
    return { ...message, action: "choose-another-file" };
  }
  if (options?.stage === "failed" && message.action === "wait") {
    return { ...message, action: "wait-retry" };
  }
  return message;
}

function baseMessageFor(error: ErrorLike, limits: UploadLimits): ErrorMessage {
  switch (error.code) {
    case "UNSUPPORTED_FORMAT":
      return {
        title: "This format isn't supported",
        description: `Only ${describeFormats(limits.allowedFormats)} videos are supported.`,
        action: "choose-another-file",
      };
    case "FILE_TOO_LARGE":
      return {
        title: "This video is too large",
        description: `Maximum size is ${formatBytes(limits.maxBytes)}.`,
        action: "choose-another-file",
      };
    case "INVALID_VIDEO_URL":
      return {
        title: "We couldn't find your upload",
        description: "This video address is not valid. Please upload again.",
        action: "choose-another-file",
      };
    case "CLOUDINARY_UPLOAD_FAILED":
      return error.retryable
        ? {
            title: "We couldn't store your video",
            description: "Try again. Your video won't be uploaded from your device again.",
            action: "retry",
          }
        : {
            title: "Can't read the video",
            description: "This file can't be processed. Try a different video.",
            action: "choose-another-file",
          };
    case "UPLOADCARE_FAILED":
      return error.retryable
        ? {
            title: "We couldn't check your upload",
            description: "The upload service had a problem. Try again.",
            action: "retry",
          }
        : {
            title: "We couldn't check your upload",
            description: "Please upload the video again.",
            action: "choose-another-file",
          };
    case "UPLOAD_INTERRUPTED":
      return {
        title: "The upload didn't finish",
        description: "Check your connection and choose the video again.",
        action: "choose-another-file",
      };
    case "RATE_LIMITED":
      return {
        title: "Too many uploads",
        description: `Try again in ${waitCopy(error.retryAfterSeconds ?? 60)}.`,
        action: "wait",
      };
    case "DATABASE_UNAVAILABLE":
      return { title: "Service unavailable", description: "Try again shortly.", action: "retry" };
    case "NETWORK_ERROR":
      return {
        title: "Connection problem",
        description: "We could not reach the server. Check your connection and try again.",
        action: "retry",
      };
    default:
      return {
        title: "Something went wrong",
        description: error.message,
        action: error.retryable ? "retry" : "none",
      };
  }
}
