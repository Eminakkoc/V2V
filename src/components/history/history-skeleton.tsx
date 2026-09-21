import { Skeleton } from "@/components/ui/skeleton";

// The shape of the panel that is about to replace it -- the tablist, the
// filter row and two cards, at the heights those actually render at (38/42 and
// 46/50 on phones) -- so the streamed content lands without shifting what the
// reader is already looking at. The page header above is never part of this:
// it needs no data and paints with the shell.
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
