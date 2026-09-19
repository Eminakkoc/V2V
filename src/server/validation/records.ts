import "server-only";
import { z } from "zod";
import { JOB_PHASES, JOB_STATUSES } from "@/lib/job-status";

export const sourceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.string().min(1),
  uploadcareUuid: z.string().min(1),
  uploadcareCdnUrl: z.url(),
  cloudinaryPublicId: z.string().min(1),
  cloudinaryUrl: z.url(),
  format: z.string().min(1),
  bytes: z.number().int().positive(),
  duration: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.date(),
});

export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const jobRecordSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.string().min(1),
  sourceId: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  status: z.enum(JOB_STATUSES),
  phase: z.enum(JOB_PHASES),
  deadlineAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  magicHourId: z.string().min(1).optional(),
  lastCheckedAt: z.date().optional(),
  claimedAt: z.date().optional(),
  estimate: z
    .object({
      credits: z.number(),
      width: z.number(),
      height: z.number(),
      fps: z.number(),
      startSeconds: z.number(),
      endSeconds: z.number(),
    })
    .optional(),
  creditsCharged: z.number().optional(),
  output: z.object({ cloudinaryPublicId: z.string(), cloudinaryUrl: z.url() }).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  magicHourError: z.object({ code: z.string(), message: z.string() }).optional(),
  retryOfJobId: z.string().optional(),
  supersededByJobId: z.string().optional(),
  lastError: z.string().optional(),
  completedAt: z.date().optional(),
});

export type JobRecord = z.infer<typeof jobRecordSchema>;
