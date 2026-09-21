import Link from "next/link";
import { memo, useId } from "react";
import { CopyableUrl } from "@/components/history/copyable-url";
import { ParamSummary } from "@/components/history/param-summary";
import { VideoPair } from "@/components/history/video-pair";
import { JobStatus } from "@/components/job/job-status";
import { RetryDialog } from "@/components/job/retry-dialog";
import { Stepper } from "@/components/job/stepper";
import { ActivityBar } from "@/components/ui/activity-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import type { HistoryJobView } from "@/lib/history-contract";

type JobCardProps = {
  // The history projection, not the bare JobView: it carries the job's own `source`, so the Source
  // player survives a reload.
  job: HistoryJobView;
  cloudName: string;
  // The card's own job, not RetryDialog's narrower JobView: a retry re-runs this job's source, and
  // the caller needs it for the new card's player.
  onRetry: (job: HistoryJobView) => void;
  retryDisabled?: boolean;
};

// memo: nothing about editing the draft below can change what this card says, and without it every
// keystroke re-rendered the card and both of its players.
export const JobCard = memo(function JobCard({
  job,
  cloudName,
  onRetry,
  retryDisabled = false,
}: JobCardProps) {
  const titleId = useId();
  const running = job.status === "processing" || job.status === "finalizing";

  return (
    <div className="flex max-w-(--card-max) flex-col gap-4 sm:gap-6">
      <section
        aria-labelledby={titleId}
        className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-md sm:gap-6 sm:p-6"
      >
        <VideoPair
          name={job.params.name}
          cloudName={cloudName}
          source={job.source}
          output={job.output}
          frameClassName="h-[150px] sm:h-[222px]"
        />

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <JobStatus job={job} />
            <p className="type-caption text-muted-foreground">
              {job.completedAt ? "Finished " : "Started "}
              <time dateTime={job.completedAt ?? job.createdAt}>
                {formatTimestamp(job.completedAt ?? job.createdAt)}
              </time>
            </p>
          </div>

          <h2 id={titleId} className="type-h3">
            {/* Two spans, not one string: the name and the art style are
                separate facts, and keeping each addressable on its own is what
                lets anything looking for "this job" find it by name. */}
            <span>{job.params.name}</span> · <span>{job.params.artStyle}</span>
          </h2>

          {running ? <ActivityBar className="max-w-[420px]" /> : null}

          <ParamSummary params={job.params} />

          <div className="flex flex-col gap-0.5">
            {job.source ? <CopyableUrl kind="source" url={job.source.cloudinaryUrl} /> : null}
            {job.output ? <CopyableUrl kind="result" url={job.output.cloudinaryUrl} /> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {job.output ? (
            <Button asChild>
              <a href={job.output.cloudinaryUrl} download>
                Download
              </a>
            </Button>
          ) : null}
          <RetryDialog job={job} onConfirm={() => onRetry(job)} disabled={retryDisabled} />
          <Link href="/history" className={buttonVariants({ variant: "ghost" })}>
            Go to History
          </Link>
        </div>
      </section>

      <Stepper job={job} />
    </div>
  );
});
