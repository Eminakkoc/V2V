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

export type CopyVideoOptions = {
  deadline: number;
  // A sanity failure (missing duration/dimensions/format) is a hard failure
  // for a user upload — it really is a bad file. For a Magic Hour render
  // result, the render is a paid asset that must not be permanently lost to
  // a Cloudinary quirk; the caller opts into treating it as retryable so a
  // redelivery gets another attempt instead of the job dying here.
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

// The caller supplies only what it has on hand; the secret and "now" live with
// the adapter so callers never have to thread config through the webhook route.
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
