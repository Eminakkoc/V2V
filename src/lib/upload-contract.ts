import { z } from "zod";

export const uploadRequestSchema = z.object({ cdnUrl: z.string().max(2048) });

export const sourceVideoSchema = z.object({
  cloudinaryPublicId: z.string(),
  cloudinaryUrl: z.string(),
  format: z.string(),
  bytes: z.number(),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
});

export const uploadResponseSchema = z.object({
  sourceId: z.string(),
  sourceVideo: sourceVideoSchema,
  posterUrl: z.string(),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const uploadSignatureSchema = z.object({
  secureSignature: z.string(),
  secureExpire: z.string(),
});

export type UploadSignature = z.infer<typeof uploadSignatureSchema>;
