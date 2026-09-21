import { Skeleton } from "@/components/ui/skeleton";

// The shape of the panel about to replace it, at the heights those elements actually render at, so
// the streamed content lands without shifting what the reader is looking at.
export function HistoryPanelSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading history
      </span>
      <div aria-hidden className="flex flex-col gap-4 sm:gap-6">
        <Skeleton className="h-[46px] w-full rounded-pill sm:h-[38px] sm:w-[251px]" />
        <Skeleton className="h-[50px] w-full sm:h-[42px]" />
        <div className="flex flex-col gap-4 sm:gap-6">
          <Skeleton className="h-[172px] w-full rounded-card" />
          <Skeleton className="h-[172px] w-full rounded-card" />
        </div>
      </div>
    </>
  );
}
