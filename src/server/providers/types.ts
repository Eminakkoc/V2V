import "server-only";
import type { TransformParams } from "@/lib/transform-contract";
import type { ProviderStatus } from "./magic-hour-mapping";

export type UploadcareFileInfo = {
  uuid: string;
  mimeType: string;
  size: number;
  originalFileUrl: string;
  originalFilename: string;
};

export type UploadcareAdapter = {
  getFileInfo(uuid: string): Promise<UploadcareFileInfo>;
};

export type StoredVideo = {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  duration: number;
  width: number;
  height: number;
};

export const CLOUDINARY_FOLDERS = { sources: "sources", results: "results" } as const;

export type CloudinaryFolder = (typeof CLOUDINARY_FOLDERS)[keyof typeof CLOUDINARY_FOLDERS];

export type CopyVideoOptions = {
  deadline: number;
  // Required rather than defaulted: a "sources" default is how finalize came to file paid renders
  // alongside user uploads.
  folder: CloudinaryFolder;
  // A sanity failure is terminal for a user upload, but a render is a paid asset, so the caller can
  // opt into treating it as retryable.
  treatSanityFailureAsRetryable?: boolean;
};

export type CloudinaryAdapter = {
  copyVideoFromUrl(url: string, options: CopyVideoOptions): Promise<StoredVideo>;
};

export type CreateJobInput = {
  jobId: string;
  videoUrl: string;
  params: TransformParams;
};

export type MagicHourDownload = { url: string; expiresAt: string | null };

export type MagicHourJobDetails = {
  magicHourId: string;
  status: ProviderStatus;
  name: string | null;
  downloads: MagicHourDownload[];
  creditsCharged: number | null;
  error: { code: string; message: string } | null;
};

export type VerifyWebhookArgs = {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  nowSeconds?: number;
};

export type VerifyWebhookResult =
  { ok: true } | { ok: false; code: "WEBHOOK_INVALID_SIGNATURE" | "WEBHOOK_STALE_TIMESTAMP" };

export type MagicHourAdapter = {
  createJob(input: CreateJobInput): Promise<{ magicHourId: string }>;
  getJobDetails(magicHourId: string): Promise<MagicHourJobDetails>;
  verifyWebhook(args: VerifyWebhookArgs): VerifyWebhookResult;
};

export type Providers = {
  uploadcare: UploadcareAdapter;
  cloudinary: CloudinaryAdapter;
  magicHour: MagicHourAdapter;
};
