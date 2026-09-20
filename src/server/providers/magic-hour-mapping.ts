import "server-only";
import type { JobErrorCode, JobPhase, JobStatus } from "@/lib/job-status";

export const JOB_NAME_PREFIX = "v2v:";
const MAX_NAME_LENGTH = 120;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function buildJobName(jobId: string, userName: string): string {
  const head = `${JOB_NAME_PREFIX}${jobId} `;
  return `${head}${userName}`.slice(0, MAX_NAME_LENGTH);
}

// Only the first token after the prefix is considered, so a user name that
// itself contains "v2v:" cannot shadow the real id.
export function parseJobName(name: string | null | undefined): string | null {
  if (!name?.startsWith(JOB_NAME_PREFIX)) return null;
  const candidate = name.slice(JOB_NAME_PREFIX.length).split(" ")[0] ?? "";
  return OBJECT_ID.test(candidate) ? candidate : null;
}

export type ProviderStatus = "draft" | "queued" | "rendering" | "complete" | "error" | "canceled";

export type MappedStatus =
  | { kind: "progress"; status: JobStatus; phase: JobPhase }
  | { kind: "complete" }
  | { kind: "failed"; errorCode: JobErrorCode }
  | { kind: "ignored" };

export function mapProviderStatus(status: ProviderStatus): MappedStatus {
  switch (status) {
    case "queued":
      return { kind: "progress", status: "processing", phase: "queued" };
    case "rendering":
      return { kind: "progress", status: "processing", phase: "rendering" };
    case "complete":
      return { kind: "complete" };
    case "error":
      return { kind: "failed", errorCode: "MAGIC_HOUR_JOB_FAILED" };
    case "canceled":
      return { kind: "failed", errorCode: "MAGIC_HOUR_JOB_CANCELED" };
    case "draft":
      return { kind: "ignored" };
  }
}
