import { z } from "zod";
import { JOB_PHASES, JOB_STATUSES } from "./job-status";
import { ART_STYLES, FPS_RESOLUTIONS, MODELS, PROMPT_TYPES, VERSIONS } from "./magic-hour-styles";

// Binary floating point makes 0.29 % 0.01 non-zero, so z.multipleOf(0.01) rejects
// values the trimmer legitimately produces. Rounding is exact for two decimals.
const twoDecimals = (value: number) => Math.round(value * 100) / 100 === value;

export const transformParamsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startSeconds: z.number().min(0).refine(twoDecimals, { error: "must have at most 2 decimals" }),
    endSeconds: z.number().min(0.1).refine(twoDecimals, { error: "must have at most 2 decimals" }),
    fpsResolution: z.enum(FPS_RESOLUTIONS).default("HALF"),
    artStyle: z.enum(ART_STYLES),
    promptType: z.enum(PROMPT_TYPES).default("default"),
    prompt: z.string().trim().max(2000).optional(),
    model: z.enum(MODELS).default("default"),
    version: z.enum(VERSIONS).default("default"),
  })
  .refine((v) => v.endSeconds > v.startSeconds, {
    error: "must be after the start",
    path: ["endSeconds"],
  })
  // The SDK requires a non-empty prompt for append_default as well as custom.
  .refine((v) => v.promptType === "default" || (v.prompt?.length ?? 0) > 0, {
    error: "is required for this prompt type",
    path: ["prompt"],
  });

export type TransformParams = z.infer<typeof transformParamsSchema>;

export const transformRequestSchema = z.object({
  sourceId: z.string().min(1).max(64),
  params: transformParamsSchema,
  retryOfJobId: z.string().min(1).max(64).optional(),
  idempotencyKey: z.uuid(),
});

export type TransformRequest = z.infer<typeof transformRequestSchema>;

export const jobViewSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  status: z.enum(JOB_STATUSES),
  phase: z.enum(JOB_PHASES),
  params: transformParamsSchema,
  createdAt: z.string(),
  deadlineAt: z.string(),
  completedAt: z.string().optional(),
  output: z.object({ cloudinaryPublicId: z.string(), cloudinaryUrl: z.url() }).optional(),
  creditsCharged: z.number().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  retryOfJobId: z.string().optional(),
  supersededByJobId: z.string().optional(),
});

export type JobView = z.infer<typeof jobViewSchema>;

export const transformResponseSchema = z.object({ job: jobViewSchema });

export type TransformResponse = z.infer<typeof transformResponseSchema>;

export const historyResponseSchema = z.object({
  items: z.array(jobViewSchema),
  nextCursor: z.string().nullable(),
  active: z.object({
    processing: z.number(),
    finalizing: z.number(),
    timedOut: z.number(),
    superseded: z.number(),
  }),
});

export type HistoryResponse = z.infer<typeof historyResponseSchema>;
