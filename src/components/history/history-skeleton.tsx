import { Skeleton } from "@/components/ui/skeleton";

// Shares the column's height the same way the real panel does, so the streamed content lands
// without resizing anything around it.
const COLUMN = "flex min-h-0 flex-1 flex-col gap-4 overflow-hidden sm:gap-6";

// The filter row and the first cards -- everything below the tabs, which is all a tab switch
// replaces.
function BodyRows() {
  return (
    <>
      <Skeleton className="h-[50px] w-full shrink-0 sm:h-[42px]" />
      <div className={COLUMN}>
        <Skeleton className="h-[172px] w-full shrink-0 rounded-card" />
        <Skeleton className="h-[172px] w-full shrink-0 rounded-card" />
      </div>
    </>
  );
}

// The shape of the panel about to replace it, at the heights those elements actually render at, so
// the streamed content lands without shifting what the reader is looking at.
export function HistoryPanelSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading history
      </span>
      <div aria-hidden className={COLUMN}>
        <Skeleton className="h-[46px] w-full shrink-0 rounded-pill sm:h-[38px] sm:w-[251px]" />
        <BodyRows />
      </div>
    </>
  );
}

// The same placeholder minus the tabs, for a tab switch: the tabs themselves stay on screen and
// already show which one was clicked.
export function HistoryBodySkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading history
      </span>
      <div aria-hidden className={COLUMN}>
        <BodyRows />
      </div>
    </>
  );
}
