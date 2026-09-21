import Link from "next/link";
import { memo, useId } from "react";
import { JobStatus } from "@/components/job/job-status";
import { ActivityBar } from "@/components/ui/activity-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import type { HistoryJobView } from "@/lib/history-contract";
import { cn } from "@/lib/utils";
import { CopyableUrl } from "./copyable-url";
import { ParamSummary } from "./param-summary";
import { VideoPair } from "./video-pair";

export type HistoryCardVariant = "top" | "attempt";

type HistoryCardProps = {
  job: HistoryJobView;
  cloudName: string;
  // "top" is the latest job in a retry chain; "attempt" is one of its earlier attempts, rendered
  // from the same markup so the two views can never drift apart.
  variant?: HistoryCardVariant;
};

// memo, with the merge keeping an unchanged row's object identity: without it, every other card on
// the page re-rendered on every poll tick.
export const HistoryCard = memo(function HistoryCard({
  job,
  cloudName,
  variant = "top",
}: HistoryCardProps) {
  const titleId = useId();
  const Heading = variant === "top" ? "h2" : "h3";
  const running = job.status === "processing" || job.status === "finalizing";

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col gap-4 p-4 sm:p-6",
        // A top-level card does not paint its own panel -- the list item owns it -- so the attempts
        // disclosure sits inside the same surface; a nested attempt paints its own, one step
        // lighter.
        variant === "attempt" && "rounded-card bg-bg",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <VideoPair
          name={job.params.name}
          cloudName={cloudName}
          source={variant === "top" ? job.source : undefined}
          output={job.output}
          frameClassName="h-[124px] lg:w-[200px]"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <JobStatus job={job} />
            {/* HIS-005: "status, timestamps, parameters and -- when complete --
                the video". Absolute and fixed-locale/timezone rather than
                relative -- see formatTimestamp -- so this needs no live region
                and never ticks (docs/design-findings.md W5). */}
            <p className="type-caption text-muted-foreground">
              Started <time dateTime={job.createdAt}>{formatTimestamp(job.createdAt)}</time>
              {job.completedAt ? (
                <>
                  {" · finished "}
                  <time dateTime={job.completedAt}>{formatTimestamp(job.completedAt)}</time>
                </>
              ) : null}
            </p>
          </div>

          <Heading id={titleId} className="type-h3">
            {/* Two spans, not one string: the name and the art style are
                separate facts, and keeping each addressable on its own is what
                lets anything looking for "this job" find it by name. */}
            <span>{job.params.name}</span> · <span>{job.params.artStyle}</span>
          </Heading>

          {running ? <ActivityBar className="max-w-[420px]" /> : null}

          <ParamSummary params={job.params} />

          <div className="flex flex-col gap-0.5">
            {variant === "top" && job.source ? (
              <CopyableUrl kind="source" url={job.source.cloudinaryUrl} />
            ) : null}
            {job.output ? <CopyableUrl kind="result" url={job.output.cloudinaryUrl} /> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:w-[170px] lg:flex-col lg:items-stretch lg:justify-center">
          {job.output ? (
            <Button asChild>
              <a href={job.output.cloudinaryUrl} download>
                Download
              </a>
            </Button>
          ) : null}
          {/* Hands the same source straight back to Create, which is where a
              new run is started from -- History has no submit path of its own. */}
          {variant === "top" && job.source ? (
            <Link
              href={`/?sourceId=${job.sourceId}`}
              className={buttonVariants({ variant: job.output ? "ghost" : "outline" })}
            >
              Restyle again
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
});
