import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BrowserScopedNote } from "@/components/history/empty-states";
import { HistoryPanelSkeleton } from "@/components/history/history-skeleton";
import { HistoryPanel } from "./history-panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "History" };

type HistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Deliberately not async: the header belongs to the static shell and paints the moment a navigation
// starts, while everything needing the query, cookie or database waits inside the boundary below --
// a loading.tsx would hide this header too.
export default function HistoryPage({ searchParams }: HistoryPageProps) {
  return (
    <div className="page-shell flex flex-col gap-4 pt-(--section-pt) pb-(--section-pb) sm:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="type-h1">History</h1>
          <BrowserScopedNote />
        </div>
        {/* The phone frames drop this: at 360px it wraps onto its own row, and
            the nav's own Create link already leads there. */}
        {/* cn(), not buttonVariants({ className }): cva concatenates without
            merging, so `hidden` and the base `inline-flex` would both land on
            the element and the stylesheet's order would decide. */}
        <Link href="/" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
          New transformation
        </Link>
      </div>
      <Suspense fallback={<HistoryPanelSkeleton />}>
        <HistoryPanel searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
