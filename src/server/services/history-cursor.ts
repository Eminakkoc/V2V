import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors/app-error";
import { toObjectId } from "@/server/repositories/documents";

export type HistorySort = "createdAt" | "duration";

export type DateCursor = { createdAt: Date; id: string };
export type DurationCursor = { clipSeconds: number; createdAt: Date; id: string };
export type HistoryCursor = DateCursor | DurationCursor;

const dateSchema = z.object({ createdAt: z.string(), id: z.string() }).strict();
const durationSchema = z
  .object({ clipSeconds: z.number(), createdAt: z.string(), id: z.string() })
  .strict();

function invalidCursor(): never {
  throw new AppError("VALIDATION_FAILED", {
    details: { fields: [{ path: "cursor", message: "is not a valid cursor" }] },
  });
}

export function encodeDateCursor(row: { createdAt: Date; id: string }): string {
  const payload = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function encodeDurationCursor(row: {
  params: { startSeconds: number; endSeconds: number };
  createdAt: Date;
  id: string;
}): string {
  const payload = {
    clipSeconds: clipSecondsOf(row.params),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

// Two decimals each, so the subtraction cannot produce a binary-float tail that would miss the same
// value recomputed in Mongo.
export function clipSecondsOf(params: { startSeconds: number; endSeconds: number }): number {
  return Math.round((params.endSeconds - params.startSeconds) * 100) / 100;
}

// The schemas are .strict(): a cursor accepted against the wrong ordering would silently repeat or
// skip rows instead of failing.
export function decodeCursor(raw: string, sort: HistorySort): HistoryCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    invalidCursor();
  }

  if (sort === "duration") {
    const result = durationSchema.safeParse(parsed);
    if (!result.success) invalidCursor();
    const createdAt = toDate(result.data.createdAt, result.data.id);
    return { clipSeconds: result.data.clipSeconds, createdAt, id: result.data.id };
  }

  const result = dateSchema.safeParse(parsed);
  if (!result.success) invalidCursor();
  return { createdAt: toDate(result.data.createdAt, result.data.id), id: result.data.id };
}

function toDate(value: string, id: string): Date {
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime()) || !toObjectId(id)) invalidCursor();
  return createdAt;
}
