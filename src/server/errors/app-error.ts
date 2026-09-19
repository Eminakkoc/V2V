import "server-only";
import type { ErrorCode } from "@/lib/error-codes";

type ErrorSpec = { status: number; retryable: boolean; message: string };

export const ERROR_SPECS: Record<ErrorCode, ErrorSpec> = {
  INVALID_VIDEO_URL: {
    status: 400,
    retryable: false,
    message: "This video address is not valid. Please upload again.",
  },
  VALIDATION_FAILED: { status: 400, retryable: false, message: "The request is not valid." },
  FILE_TOO_LARGE: {
    status: 413,
    retryable: false,
    message: "The video is larger than the allowed size.",
  },
  REQUEST_TOO_LARGE: { status: 413, retryable: false, message: "The request is too large." },
  UNSUPPORTED_FORMAT: {
    status: 415,
    retryable: false,
    message: "This video format is not supported.",
  },
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    message: "Too many requests. Please wait and try again.",
  },
  UPLOADCARE_FAILED: {
    status: 502,
    retryable: true,
    message: "We could not check your upload. Please try again.",
  },
  CLOUDINARY_UPLOAD_FAILED: {
    status: 502,
    retryable: true,
    message: "We could not store your video. Please try again.",
  },
  DATABASE_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message: "Service unavailable, try again shortly.",
  },
  INTERNAL: { status: 500, retryable: false, message: "Something went wrong on our side." },
};

type AppErrorOptions = {
  message?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const spec = ERROR_SPECS[code];
    super(options.message ?? spec.message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = spec.status;
    this.retryable = options.retryable ?? spec.retryable;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
