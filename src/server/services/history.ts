import "server-only";
import { z } from "zod";
import { JOB_STATUSES } from "@/lib/job-status";
import { ART_STYLES } from "@/lib/magic-hour-styles";
import type { HistoryResponse } from "@/lib/transform-contract";
import type { ServerDeps } from "@/server/deps";
import { AppError } from "@/server/errors/app-error";
import { toObjectId } from "@/server/repositories/documents";
import type { Job } from "@/server/repositories/jobs";
import { toJobView } from "@/server/services/job-view";

// tab is a literal, not the spec's jobs|sources enum: the sources listing
// belongs to the History page next cycle, and Task 5 provides no sources
// query. Widening this later is additive.
export const historyQuerySchema = z
  .object({
    tab: z.literal("jobs").default("jobs"),
    status: z.enum(JOB_STATUSES).optional(),
    style: z.enum(ART_STYLES).optional(),
    includePrevious: z.stringbool().default(false),
    dir: z.enum(["asc", "desc"]).default("desc"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  })
  .strict();

type HistoryQuery = z.infer<typeof historyQuerySchema>;

const cursorSchema = z.object({ createdAt: z.string(), id: z.string() });

function invalidCursor(): never {
  throw new AppError("VALIDATION_FAILED", {
    details: { fields: [{ path: "cursor", message: "is not a valid cursor" }] },
  });
}

// listForUser silently drops a malformed cursor bound rather than reject it —
// correct for a repository that only receives decoded values, but wrong for
// user-facing pagination. The decode happens here, so the rejection does too.
function decodeCursor(raw: string): { createdAt: Date; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) invalidCursor();
  const createdAt = new Date(result.data.createdAt);
  if (Number.isNaN(createdAt.getTime()) || !toObjectId(result.data.id)) invalidCursor();
  return { createdAt, id: result.data.id };
}

function encodeCursor(job: Job): string {
  const payload = { createdAt: job.createdAt.toISOString(), id: job.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export async function listHistory(
  query: HistoryQuery,
  userId: string,
  deps: Pick<ServerDeps, "jobs" | "config">,
  now: () => Date = () => new Date(),
): Promise<HistoryResponse> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  // One extra row decides nextCursor without a second round trip.
  const rows = await deps.jobs.listForUser(userId, {
    ...(query.status ? { statuses: [query.status] } : {}),
    artStyle: query.style,
    includePrevious: query.includePrevious,
    sort: "createdAt",
    dir: query.dir,
    limit: query.limit + 1,
    cursor,
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  const active = await deps.jobs.countActive(userId, now(), deps.config.jobGraceMinutes * 60_000);
  return {
    items: items.map(toJobView),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    active,
  };
}
