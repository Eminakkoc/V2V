import { z } from "zod";
import { STATUS_BUCKETS } from "./history-filters";
import { JOB_STATUSES } from "./job-status";
import { ART_STYLES } from "./magic-hour-styles";
import { jobViewSchema } from "./transform-contract";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_IDS = 50;

// Job-shaping parameters; a mode that cannot honour one refuses it rather than accepting and
// ignoring it, since a silently ignored filter reads as a filter that ran.
const JOB_ONLY = ["status", "statusBucket", "style", "includePrevious", "sort", "dir"] as const;

export const historyQuerySchema = z
  .object({
    tab: z.enum(["jobs", "sources"]).default("jobs"),
    status: z.enum(JOB_STATUSES).optional(),
    statusBucket: z.enum(STATUS_BUCKETS).optional(),
    style: z.enum(ART_STYLES).optional(),
    includePrevious: z.stringbool().default(false),
    sort: z.enum(["createdAt", "duration"]).default("createdAt"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
    changeable: z.stringbool().default(false),
    ids: z
      .string()
      .transform((raw) => [
        ...new Set(
          raw
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ])
      .refine((ids) => ids.length > 0 && ids.length <= MAX_IDS, {
        error: `must name between 1 and ${MAX_IDS} jobs`,
      })
      .refine((ids) => ids.every((id) => OBJECT_ID.test(id)), { error: "must be job ids" })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Only the checks a parsed value can legitimately make -- every other combination is rejected
    // on the raw record, where a defaulted value is still distinguishable from one the caller sent.
    if (value.status && value.statusBucket) {
      ctx.addIssue({
        code: "custom",
        path: ["statusBucket"],
        message: "cannot be combined with status",
      });
    }
    if (value.changeable && value.ids) {
      ctx.addIssue({
        code: "custom",
        path: ["ids"],
        message: "cannot be combined with changeable",
      });
    }
  });

export type HistoryQueryInput = z.infer<typeof historyQuerySchema>;

// Raw-presence guard run before historyQuerySchema.parse; it throws a ZodError rather than the
// server-only AppError, which with-error-handling.ts already maps to VALIDATION_FAILED.
export function parseHistoryQuery(raw: Record<string, string>): HistoryQueryInput {
  const present = new Set(Object.keys(raw));
  const issues: z.core.$ZodIssue[] = [];
  const forbid = (keys: readonly string[], because: string) => {
    for (const key of keys) {
      if (present.has(key)) {
        issues.push({ code: "custom", path: [key], message: `cannot be combined with ${because}` });
      }
    }
  };
  if (raw.tab === "sources") forbid([...JOB_ONLY, "changeable", "ids"], "tab=sources");
  if (raw.changeable === "true") forbid([...JOB_ONLY, "cursor", "limit"], "changeable");
  if (raw.ids !== undefined) forbid([...JOB_ONLY, "cursor", "limit"], "ids");
  if (issues.length > 0) throw new z.ZodError(issues);
  return historyQuerySchema.parse(raw);
}

export const sourceProjectionSchema = z.object({
  cloudinaryPublicId: z.string(),
  cloudinaryUrl: z.url(),
  duration: z.number(),
});

export const attemptViewSchema = jobViewSchema;
export type AttemptView = z.infer<typeof attemptViewSchema>;

export const historyJobViewSchema = jobViewSchema.extend({
  source: sourceProjectionSchema.nullable(),
  attempts: z.array(attemptViewSchema),
});

export type HistoryJobView = z.infer<typeof historyJobViewSchema>;

export const historyJobsResponseSchema = z.object({
  items: z.array(historyJobViewSchema),
  nextCursor: z.string().nullable(),
  active: z.object({
    processing: z.number(),
    finalizing: z.number(),
    timedOut: z.number(),
    superseded: z.number(),
  }),
});

export type HistoryJobsResponse = z.infer<typeof historyJobsResponseSchema>;

export const sourceViewSchema = z.object({
  id: z.string(),
  cloudinaryPublicId: z.string(),
  cloudinaryUrl: z.url(),
  format: z.string(),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  createdAt: z.string(),
  transformCount: z.number(),
});

export type SourceView = z.infer<typeof sourceViewSchema>;

export const historySourcesResponseSchema = z.object({
  items: z.array(sourceViewSchema),
  nextCursor: z.string().nullable(),
});

export type HistorySourcesResponse = z.infer<typeof historySourcesResponseSchema>;
