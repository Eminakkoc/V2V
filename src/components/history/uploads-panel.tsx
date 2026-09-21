import { Button } from "@/components/ui/button";
import type { SourceView } from "@/lib/history-contract";
import { HistoryEmptyState } from "./empty-states";
import { SourceCard } from "./source-card";

export type UploadsPanelProps = {
  // Taken as a prop rather than read from a server value held elsewhere, which is what lets the
  // empty state below dissolve without a reload.
  sources: readonly SourceView[];
  cloudName: string;
  hasMore: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  // The Uploads tab has no filter controls of its own today, but this stays a real prop so the
  // no-match state is available the day one is added.
  hasActiveFilter?: boolean;
  uploadHref?: string;
  clearFiltersHref?: string;
};

// Never reads job data, so its empty state can never show the Transformations tab's copy.
export function UploadsPanel({
  sources,
  cloudName,
  hasMore,
  onLoadMore,
  loadingMore = false,
  hasActiveFilter = false,
  uploadHref = "/",
  clearFiltersHref = "/history?tab=sources",
}: UploadsPanelProps) {
  const hasRows = sources.length > 0;

  return (
    // The one scrolling box on the page, so the tabs above it never leave; the inset padding keeps
    // card shadows and focus rings from being clipped against its edges. `relative` is load-bearing:
    // a visually hidden live region is position:absolute and would otherwise escape the clip and
    // stretch the document back into a page scroll.
    <div
      data-slot="history-scroll"
      className="relative -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 sm:gap-6"
    >
      <HistoryEmptyState
        tab="uploads"
        rows={sources}
        hasActiveFilter={hasActiveFilter}
        uploadHref={uploadHref}
        clearFiltersHref={clearFiltersHref}
      />

      {hasRows ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {sources.map((source) => (
            <li key={source.id} className="flex">
              <SourceCard source={source} cloudName={cloudName} />
            </li>
          ))}
        </ul>
      ) : null}

      {/* The last-page state only drops this button -- it adds no copy of
          its own, so there is nothing to render in the `else` branch. */}
      {hasRows && hasMore ? (
        <Button
          type="button"
          variant="outline"
          onClick={onLoadMore}
          disabled={loadingMore}
          aria-busy={loadingMore}
          className="self-center"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
