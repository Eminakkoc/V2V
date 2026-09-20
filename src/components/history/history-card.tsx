import { useId } from "react";
import { JobStatus } from "@/components/job/job-status";
import type { HistoryJobView } from "@/lib/history-contract";
import { ParamSummary } from "./param-summary";
import { VideoPair } from "./video-pair";

export type HistoryCardVariant = "top" | "attempt";

type HistoryCardProps = {
  job: HistoryJobView;
  cloudName: string;
  // "top": the latest job in a retry chain, rendered as its own list item.
  // "attempt": one of its earlier attempts, rendered by PreviousAttempts
  // inside the disclosure (HIS-005) -- same markup, so the two views can
  // never drift apart. The only behavioural difference is the heading level
  // and that an attempt never renders its own Source column (see VideoPair).
  variant?: HistoryCardVariant;
};

// One card renders both a top-level job and a nested earlier attempt. The
// brief names three deliverables for this view by name -- source URL,
// transformation parameters, generated URL -- so all three are visible here
// as text/links, not merely implied by the video players.
export function HistoryCard({ job, cloudName, variant = "top" }: HistoryCardProps) {
  const titleId = useId();
  const Heading = variant === "top" ? "h2" : "h3";

  return (
    <section
      aria-labelledby={titleId}
      className="@container flex flex-col gap-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={titleId} className="text-lg font-medium">
          {job.params.name}
        </Heading>
        <JobStatus job={job} />
      </div>
      <ParamSummary params={job.params} />
      <VideoPair
        name={job.params.name}
        cloudName={cloudName}
        source={variant === "top" ? job.source : undefined}
        output={job.output}
      />
    </section>
  );
}
