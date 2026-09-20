import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AttemptView, HistoryJobView } from "@/lib/history-contract";
import type { JobStatus } from "@/lib/job-status";
import { cn } from "@/lib/utils";
import { HistoryCard } from "./history-card";

// Statuses this DISPLAY predicate treats as "finished", for the attempts
// header count only -- an attempt that has stopped progressing on the
// normal processing/finalizing cadence. This is NOT the same as a
// lifecycle-terminal set: a `timed_out` or `abandoned` attempt is still
// re-checked by reconciliation, and this count simply follows whatever it
// becomes on the next refresh -- it can rise, fall, or a `timed_out` row
// can later become `complete` without ever leaving "finished". `superseded`
// is deliberately excluded: every previous attempt is superseded by
// definition (that is what makes it a previous attempt), so counting it
// here would count every row, every time, telling the reader nothing.
const FINISHED_STATUSES: ReadonlySet<JobStatus> = new Set([
  "complete",
  "failed",
  "timed_out",
  "abandoned",
]);

function isFinished(attempt: AttemptView): boolean {
  return FINISHED_STATUSES.has(attempt.status);
}

// The AttemptView -> HistoryJobView shape HistoryCard's `job` prop expects.
// `source` and `attempts` are inert filler: HistoryCard never reads either
// for variant="attempt" (an attempt shares its source with the owning job,
// which already shows it, and a chain is never nested more than one level
// deep), so their exact value doesn't matter.
function toHistoryJobView(attempt: AttemptView): HistoryJobView {
  return { ...attempt, source: null, attempts: [] };
}

type PreviousAttemptsProps = {
  attempts: AttemptView[];
  cloudName: string;
};

// F11: a collapsed-by-default disclosure listing a job's earlier attempts
// oldest-to-newest, reusing HistoryCard (HIS-005) so the nested view can
// never drift from the top-level one.
export function PreviousAttempts({ attempts, cloudName }: PreviousAttemptsProps) {
  if (attempts.length === 0) return null;

  const ordered = [...attempts].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const finishedCount = ordered.filter(isFinished).length;
  const headerText =
    finishedCount > 0
      ? `Previous attempts (${ordered.length}) — ${finishedCount} finished`
      : `Previous attempts (${ordered.length})`;

  return (
    <Collapsible className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <CollapsibleTrigger
          className={cn(
            "flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium",
            "data-[state=open]:[&>svg]:rotate-180",
          )}
        >
          <ChevronDown aria-hidden className="size-4 transition-transform" />
          {headerText}
        </CollapsibleTrigger>
        {/* F11: surfaced next to the header, not only inside the expanded
            content, so a reader never has to open the disclosure to learn a
            paid result exists behind a card that currently reads Failed. */}
        {finishedCount > 0 ? (
          <p className="text-sm text-muted-foreground">An earlier attempt finished — view result</p>
        ) : null}
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col gap-4">
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
