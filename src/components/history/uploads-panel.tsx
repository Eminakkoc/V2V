import { Button } from "@/components/ui/button";
import type { SourceView } from "@/lib/history-contract";
import { BrowserScopedNote, HistoryEmptyState } from "./empty-states";
import { SourceCard } from "./source-card";

export type UploadsPanelProps = {
  // The merged/current list of sources, taken as a prop rather than read
  // from a server value held elsewhere -- see HistoryEmptyState. Passing a
  // freshly merged array here on every render is what makes the empty
  // state below dissolve without a reload.
  sources: readonly SourceView[];
  cloudName: string;
  hasMore: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  // The Uploads tab has no filter controls of its own today (F18's status
  // and style filters apply to Transformations only), so this defaults to
  // false. It stays a real prop, not a hardcoded false, so the no-match
  // state HistoryEmptyState already knows how to render is available the
  // day a filter is added here, with no change to the selection logic.
  hasActiveFilter?: boolean;
  uploadHref?: string;
  clearFiltersHref?: string;
};

// The Uploaded videos tab's content (section 7, Task 21). Owns nothing about
// the Transformations tab -- it never reads job data -- so its empty state
// can never show that tab's copy (see HistoryEmptyState's "never compete"
// guarantee).
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
    <div className="flex flex-col gap-4">
      <BrowserScopedNote />

      <HistoryEmptyState
        tab="uploads"
        rows={sources}
        hasActiveFilter={hasActiveFilter}
        uploadHref={uploadHref}
        clearFiltersHref={clearFiltersHref}
      />

      {hasRows ? (
        <ul className="flex flex-col gap-4">
          {sources.map((source) => (
            <li key={source.id}>
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
          className="min-h-11 self-center"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
