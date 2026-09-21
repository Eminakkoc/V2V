import { CircleCheck, CircleX, Clock, Loader } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { labelFor, type JobTone } from "@/lib/job-labels";
import type { JobView } from "@/lib/transform-contract";

const TONE_BADGE = {
  pending: { tone: "neutral", Icon: Clock },
  active: { tone: "accent", Icon: Loader },
  done: { tone: "accent2", Icon: CircleCheck },
  error: { tone: "error", Icon: CircleX },
} satisfies Record<
  JobTone,
  { tone: "neutral" | "accent" | "accent2" | "error"; Icon: typeof Clock }
>;

type JobStatusProps = {
  job: Pick<JobView, "status" | "phase" | "errorCode" | "errorMessage">;
};

// A superseded job is hidden from the current-status display (it only appears
// inside "Previous attempts"), which `labelFor` expresses as `hidden` data
// rather than this component special-casing the `superseded` status itself.
export function JobStatus({ job }: JobStatusProps) {
  const { label, tone, hidden } = labelFor(job);
  if (hidden) return null;

  // Figma gives "Taking longer than expected" the only outlined badge in the
  // set, so a job that is still running can never read as finished. That is a
  // presentation split, not a new label tone, so it is resolved here from the
  // status rather than by widening JobTone.
  const outlined = job.status === "timed_out";
  const { tone: badgeTone, Icon } = TONE_BADGE[tone];

  return (
    <span aria-live="polite">
      <Badge size="status" tone={outlined ? "waiting" : badgeTone}>
        {/* Static on purpose: a spinner beside other content would animate for
            minutes on end (WCAG 2.2.2). */}
        <Icon aria-hidden strokeWidth={2.75} />
        {label}
      </Badge>
    </span>
  );
}
