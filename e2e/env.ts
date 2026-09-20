export const E2E_PORT = 3100;

// Exported on its own (not read back off E2E_ENV) so a signing helper gets a
// plain `string`: E2E_ENV is typed as an index signature for spreading into a
// child process's env, and noUncheckedIndexedAccess would widen a property
// read off it to `string | undefined`.
export const E2E_WEBHOOK_SECRET = "e2e-webhook-secret";

export const E2E_ENV: Record<string, string> = {
  PROVIDER_MODE: "fake",
  NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY: "e2e-public-key",
  UPLOADCARE_SECRET_KEY: "e2e-uploadcare-secret",
  CLOUDINARY_CLOUD_NAME: "e2e-cloud",
  CLOUDINARY_API_KEY: "e2e-cloudinary-key",
  CLOUDINARY_API_SECRET: "e2e-cloudinary-secret",
  MAGIC_HOUR_API_KEY: "e2e-magic-hour-key",
  MAGIC_HOUR_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
  MONGODB_DB_NAME: "v2v_e2e",
  SESSION_COOKIE_SECRET: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  MAX_UPLOAD_BYTES: "104857600",
  ALLOWED_VIDEO_FORMATS: "video/mp4,video/quicktime,video/webm",
  MAX_CLIP_SECONDS: "30",
  JOB_GRACE_MINUTES: "120",
  JOB_DEADLINE_BASE_MINUTES: "5",
  JOB_DEADLINE_SECONDS_PER_CLIP_SECOND: "30",
  JOB_DEADLINE_MAX_MINUTES: "30",
};
