import { parseConfig } from "@/config/env";

export const testEnv: Record<string, string> = {
  NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY: "test-public-key",
  UPLOADCARE_SECRET_KEY: "test-uploadcare-secret",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-cloudinary-key",
  CLOUDINARY_API_SECRET: "test-cloudinary-secret",
  MAGIC_HOUR_API_KEY: "test-magic-hour-key",
  MAGIC_HOUR_WEBHOOK_SECRET: "test-webhook-secret",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_DB_NAME: "v2v_test",
  SESSION_COOKIE_SECRET: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  MAX_UPLOAD_BYTES: "104857600",
  ALLOWED_VIDEO_FORMATS: "video/mp4,video/quicktime,video/webm",
  MAX_CLIP_SECONDS: "30",
  JOB_GRACE_MINUTES: "120",
  JOB_DEADLINE_BASE_MINUTES: "5",
  JOB_DEADLINE_SECONDS_PER_CLIP_SECOND: "30",
  JOB_DEADLINE_MAX_MINUTES: "30",
};

export const testConfig = parseConfig(testEnv);
