import { Badge } from "@/components/ui/badge";
import { labelFor, type JobTone } from "@/lib/job-labels";
import type { JobView } from "@/lib/transform-contract";

const TONE_VARIANT = {
  pending: "secondary",
  active: "default",
  done: "outline",
  error: "destructive",
} satisfies Record<JobTone, "secondary" | "default" | "outline" | "destructive">;

type JobStatusProps = {
  job: Pick<JobView, "status" | "phase" | "errorCode" | "errorMessage">;
};

// A superseded job is hidden from the current-status display (it only appears
// inside "Previous attempts"), which `labelFor` expresses as `hidden` data
// rather than this component special-casing the `superseded` status itself.
export function JobStatus({ job }: JobStatusProps) {
  const { label, tone, hidden } = labelFor(job);
  if (hidden) return null;

  return (
    <span aria-live="polite">
      <Badge variant={TONE_VARIANT[tone]}>{label}</Badge>
    </span>
  );
}
