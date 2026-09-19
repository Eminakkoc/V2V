import { z } from "zod";

export const ERROR_CODES = [
  "INVALID_VIDEO_URL",
  "VALIDATION_FAILED",
  "FILE_TOO_LARGE",
  "REQUEST_TOO_LARGE",
  "UNSUPPORTED_FORMAT",
  "RATE_LIMITED",
  "UPLOADCARE_FAILED",
  "CLOUDINARY_UPLOAD_FAILED",
  "DATABASE_UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const errorCodeSet: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return errorCodeSet.has(value);
}

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;
