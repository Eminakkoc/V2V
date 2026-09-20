import { JobStatus } from "@/components/job/job-status";
import { RetryDialog } from "@/components/job/retry-dialog";
import { posterUrl } from "@/lib/cloudinary-urls";
import { formatDuration } from "@/lib/format";
import type { JobView } from "@/lib/transform-contract";

type JobCardProps = {
  job: JobView;
  cloudName: string;
  onRetry: (job: JobView) => void;
  retryDisabled?: boolean;
};

export function JobCard({ job, cloudName, onRetry, retryDisabled = false }: JobCardProps) {
  const clipSeconds = job.params.endSeconds - job.params.startSeconds;

  return (
    <section aria-labelledby="job-card-title" className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="job-card-title" className="text-lg font-medium">
          {job.params.name}
        </h2>
        <div className="flex items-center gap-2">
          <JobStatus job={job} />
          <RetryDialog job={job} onConfirm={onRetry} disabled={retryDisabled} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {job.params.artStyle} · {formatDuration(clipSeconds)} clip
      </p>
      {job.output ? (
        <video
          aria-label={`Result: ${job.params.name}`}
          className="aspect-video w-full rounded-lg bg-muted"
          src={job.output.cloudinaryUrl}
          poster={posterUrl(cloudName, job.output.cloudinaryPublicId)}
          controls
          muted
          playsInline
          preload="metadata"
        />
      ) : null}
    </section>
  );
}
