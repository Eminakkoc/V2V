import type { JobPhase } from "./job-status";
import type { JobView } from "./transform-contract";

export type JobTone = "pending" | "active" | "done" | "error";

export type JobLabel = {
  label: string;
  tone: JobTone;
  // Only true for `superseded`: the current-status badge suppresses it, but the
  // label text is still real data for a "Previous attempts" list to show.
  hidden?: boolean;
};

type LabelInput = Pick<JobView, "status" | "phase" | "errorCode" | "errorMessage">;

const PROCESSING_LABELS: Record<JobPhase, JobLabel> = {
  queued: { label: "Queued", tone: "pending" },
  submitting: { label: "Confirming with Magic Hour", tone: "pending" },
  rendering: { label: "Rendering", tone: "active" },
};

export function labelFor(job: LabelInput): JobLabel {
  switch (job.status) {
    case "processing":
      return PROCESSING_LABELS[job.phase];
    case "finalizing":
      return { label: "Saving result", tone: "active" };
    case "complete":
      return { label: "Complete", tone: "done" };
    case "failed":
      if (job.errorCode === "MAGIC_HOUR_JOB_CANCELED") {
        return { label: "Cancelled in Magic Hour", tone: "error" };
      }
      return {
        label: job.errorMessage ? `Failed: ${job.errorMessage}` : "Failed",
        tone: "error",
      };
    case "timed_out":
      return { label: "Taking longer than expected. Still checking", tone: "pending" };
    case "superseded":
      return { label: "Superseded", tone: "pending", hidden: true };
    case "abandoned":
      // Wording here comes from the architecture doc (§13), not Figma. Figma's copy
      // says an abandoned job "won't be saved here" — that is wrong: a late result
      // from Magic Hour is still saved against the job. Do not "fix" this back to
      // the Figma copy.
      if (job.errorCode === "SUBMISSION_UNCONFIRMED") {
        return { label: "Lost contact with Magic Hour. Still added if it finishes", tone: "error" };
      }
      return { label: "Stopped checking. Still added if Magic Hour finishes it", tone: "error" };
  }
}
