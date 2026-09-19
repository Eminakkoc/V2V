import "server-only";
import { generateSecureSignature } from "@uploadcare/signed-uploads";
import type { UploadSignature } from "@/lib/upload-contract";

export const SIGNATURE_LIFETIME_MS = 30 * 60 * 1000;

export function createUploadSignature(secretKey: string, now = Date.now()): UploadSignature {
  return generateSecureSignature(secretKey, { expire: now + SIGNATURE_LIFETIME_MS });
}
