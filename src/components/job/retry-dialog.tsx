"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { JobView } from "@/lib/transform-contract";

// Magic Hour has no cancel API: it charges for frames already rendered and
// refunds a job outright once it fails. A retry is a brand-new submission of
// the same source and params, offered only once the original is truly done —
// never while it might still finish and be charged for twice.
// Only `failed` is reachable this cycle -- see the dormancy note on
// JOB_STATUSES. The other two stay listed so Retry works without a change the
// day reconciliation starts writing them.
const RETRYABLE_STATUSES = new Set<JobView["status"]>(["failed", "timed_out", "abandoned"]);

export type RetryDialogProps = {
  job: JobView;
  onConfirm: (job: JobView) => void;
  disabled?: boolean;
};

export function RetryDialog({ job, onConfirm, disabled = false }: RetryDialogProps) {
  if (!RETRYABLE_STATUSES.has(job.status)) return null;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          Retry
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retry this clip?</AlertDialogTitle>
          <AlertDialogDescription>
            This starts a new job from the same clip and options and charges credits again. The
            original job is kept, not replaced.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(job)}>Retry anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
