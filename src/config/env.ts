import "server-only";
import { z } from "zod";

const required = z.string({ error: "is required" }).trim().min(1, { error: "is required" });

const positiveWholeNumber = z
  .string({ error: "is required" })
  .regex(/^[1-9]\d*$/, { error: "must be a positive whole number" })
  .transform(Number);

const videoFormats = required.transform((value, ctx) => {
  const formats = value.split(",").map((format) => format.trim().toLowerCase());
  if (formats.some((format) => !/^video\/[a-z0-9.+-]+$/.test(format))) {
    ctx.addIssue({ code: "custom", message: "must be comma-separated video/* MIME types" });
    return z.NEVER;
  }
  return formats;
});

const envSchema = z.object({
  NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY: required,
  UPLOADCARE_SECRET_KEY: required,
  CLOUDINARY_CLOUD_NAME: required,
  CLOUDINARY_API_KEY: required,
  CLOUDINARY_API_SECRET: required,
  MAGIC_HOUR_API_KEY: required,
  MAGIC_HOUR_WEBHOOK_SECRET: required,
  MONGODB_URI: required.refine((value) => /^mongodb(\+srv)?:\/\//.test(value), {
    error: "must start with mongodb:// or mongodb+srv://",
  }),
  MONGODB_DB_NAME: required,
  SESSION_COOKIE_SECRET: required.refine((value) => Buffer.from(value, "base64").length >= 32, {
    error: "must decode to at least 32 bytes",
  }),
  MAX_UPLOAD_BYTES: positiveWholeNumber,
  ALLOWED_VIDEO_FORMATS: videoFormats,
  MAX_CLIP_SECONDS: positiveWholeNumber,
  JOB_GRACE_MINUTES: positiveWholeNumber,
  PROVIDER_MODE: z.enum(["real", "fake"], { error: "must be real or fake" }).default("real"),
});

export type AppConfig = {
  uploadcare: { publicKey: string; secretKey: string };
  cloudinary: { cloudName: string; apiKey: string; apiSecret: string };
  magicHour: { apiKey: string; webhookSecret: string };
  mongodb: { uri: string; dbName: string };
  sessionCookieSecret: string;
  upload: { maxBytes: number; allowedFormats: string[] };
  maxClipSeconds: number;
  jobGraceMinutes: number;
  providerMode: "real" | "fake";
};

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid environment: ${problems.join("; ")}`);
    this.name = "ConfigError";
  }
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  const problems = new Map<string, string>();
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? "environment");
      if (!problems.has(name)) problems.set(name, `${name} ${issue.message}`);
    }
  }
  if (env.PROVIDER_MODE === "fake" && env.VERCEL) {
    problems.set("PROVIDER_MODE", "PROVIDER_MODE must not be fake on Vercel");
  }
  if (!result.success || problems.size > 0) throw new ConfigError([...problems.values()]);

  const values = result.data;
  return {
    uploadcare: {
      publicKey: values.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY,
      secretKey: values.UPLOADCARE_SECRET_KEY,
    },
    cloudinary: {
      cloudName: values.CLOUDINARY_CLOUD_NAME,
      apiKey: values.CLOUDINARY_API_KEY,
      apiSecret: values.CLOUDINARY_API_SECRET,
    },
    magicHour: {
      apiKey: values.MAGIC_HOUR_API_KEY,
      webhookSecret: values.MAGIC_HOUR_WEBHOOK_SECRET,
    },
    mongodb: { uri: values.MONGODB_URI, dbName: values.MONGODB_DB_NAME },
    sessionCookieSecret: values.SESSION_COOKIE_SECRET,
    upload: { maxBytes: values.MAX_UPLOAD_BYTES, allowedFormats: values.ALLOWED_VIDEO_FORMATS },
    maxClipSeconds: values.MAX_CLIP_SECONDS,
    jobGraceMinutes: values.JOB_GRACE_MINUTES,
    providerMode: values.PROVIDER_MODE,
  };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}
