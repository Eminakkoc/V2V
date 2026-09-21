import { ChevronDown } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AttemptView, HistoryJobView } from "@/lib/history-contract";
import type { JobStatus } from "@/lib/job-status";
import { cn } from "@/lib/utils";
import { HistoryCard } from "./history-card";

// A display-only notion of "finished" for the header count, not a lifecycle-terminal set -- the
// count can rise or fall on a later refresh, and `superseded` is excluded because every previous
// attempt is superseded by definition.
const FINISHED_STATUSES: ReadonlySet<JobStatus> = new Set([
  "complete",
  "failed",
  "timed_out",
  "abandoned",
]);

function isFinished(attempt: AttemptView): boolean {
  return FINISHED_STATUSES.has(attempt.status);
}

// `source` and `attempts` are inert filler: HistoryCard never reads either for variant="attempt".
function toHistoryJobView(attempt: AttemptView): HistoryJobView {
  return { ...attempt, source: null, attempts: [] };
}

type PreviousAttemptsProps = {
  attempts: AttemptView[];
  cloudName: string;
};

// A collapsed-by-default disclosure listing a job's earlier attempts oldest-to-newest, reusing
// HistoryCard so the nested view can never drift from the top-level one.
export function PreviousAttempts({ attempts, cloudName }: PreviousAttemptsProps) {
  if (attempts.length === 0) return null;

  const ordered = [...attempts].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const finishedCount = ordered.filter(isFinished).length;

  return (
    <Collapsible className="flex flex-col gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
      {/* F11: surfaced next to the header, not only inside the expanded
          content, so a reader never has to open the disclosure to learn a
          paid result exists behind a card that currently reads Failed. */}
      {finishedCount > 0 ? (
        <Alert tone="success" kind="callout" role="status">
          <p className="min-w-[200px] flex-1 type-body">
            An earlier attempt finished, so a result is already waiting.
          </p>
        </Alert>
      ) : null}
      <CollapsibleTrigger
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg border-t border-divider py-(--disclosure-py) type-body font-semibold focus-ring",
          "data-[state=open]:[&>svg]:rotate-180",
        )}
      >
        <ChevronDown aria-hidden className="size-[18px] shrink-0 transition-transform" />
        Previous attempts ({ordered.length}){" "}
        {finishedCount > 0 ? (
          <span className="type-caption font-normal text-muted-foreground">
            {finishedCount} finished
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-4 pl-0 sm:pl-8">
          {ordered.map((attempt) => (
            <li key={attempt.id}>
              <HistoryCard
                job={toHistoryJobView(attempt)}
                cloudName={cloudName}
                variant="attempt"
              />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
