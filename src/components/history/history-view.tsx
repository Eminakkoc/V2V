"use client";

import { useCallback, useState } from "react";
import { useHistoryRefresh } from "@/hooks/use-history-refresh";
import { apiFetch } from "@/lib/api-client";
import {
  historyJobsResponseSchema,
  historySourcesResponseSchema,
  type HistoryJobsResponse,
  type HistoryJobView,
  type HistoryQueryInput,
  type HistorySourcesResponse,
  type SourceView,
} from "@/lib/history-contract";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BrowserScopedNote, HistoryEmptyState } from "./empty-states";
import { FilterBar } from "./filter-bar";
import { HistoryCard } from "./history-card";
import { HistoryTabs } from "./history-tabs";
import { PreviousAttempts } from "./previous-attempts";
import { UploadsPanel } from "./uploads-panel";

// Loaded via `load more`, one page at a time -- never through URL navigation,
// so this is genuinely client-only state (see history-merge.ts, section 6.4).
function jobsLoadMoreUrl(query: HistoryQueryInput, cursor: string): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.statusBucket) params.set("statusBucket", query.statusBucket);
  if (query.style) params.set("style", query.style);
  if (query.includePrevious) params.set("includePrevious", "true");
  params.set("sort", query.sort);
  params.set("dir", query.dir);
  params.set("limit", String(query.limit));
  params.set("cursor", cursor);
  return `/api/history?${params.toString()}`;
}

function sourcesLoadMoreUrl(query: HistoryQueryInput, cursor: string): string {
  const params = new URLSearchParams({ tab: "sources", limit: String(query.limit), cursor });
  return `/api/history?${params.toString()}`;
}

function hasActiveJobFilter(query: HistoryQueryInput): boolean {
  return Boolean(query.status || query.statusBucket || query.style);
}

export type HistoryViewProps =
  | {
      tab: "jobs";
      query: HistoryQueryInput;
      initial: HistoryJobsResponse;
      hasUploads: boolean;
      cloudName: string;
    }
  | {
      tab: "sources";
      query: HistoryQueryInput;
      initial: HistorySourcesResponse;
      cloudName: string;
    };

// The client shell (HIS-003). The page keys this component on the serialized
// search params, so a filter/sort/tab/include-previous navigation unmounts
// and remounts it -- that remount *is* the "clears the loaded pages and the
// cursor and restarts from the first page" requirement (see history-view's
// own module scope: there is no reset effect here to get wrong, because
// there is nothing to reset -- a fresh mount starts from `initial` alone).
export function HistoryView(props: HistoryViewProps) {
  return (
    <HistoryTabs active={props.tab}>
      {props.tab === "jobs" ? (
        <TransformationsPanel
          query={props.query}
          initial={props.initial}
          hasUploads={props.hasUploads}
          cloudName={props.cloudName}
        />
      ) : (
        <SourcesPanel query={props.query} initial={props.initial} cloudName={props.cloudName} />
      )}
    </HistoryTabs>
  );
}

type TransformationsPanelProps = {
  query: HistoryQueryInput;
  initial: HistoryJobsResponse;
  hasUploads: boolean;
  cloudName: string;
};

function TransformationsPanel({
  query,
  initial,
  hasUploads,
  cloudName,
}: TransformationsPanelProps) {
  // Rows fetched by `load more`, beyond the server-rendered first page.
  // Handed to useHistoryRefresh as `additional` (not merged here) so the
  // hook's own tracked list includes them: without that, the account-wide
  // poll would still report a status change for one of these rows, but
  // mergeRefreshed would treat it as not-yet-loaded and defer it under the
  // insertion-window rule for as long as more pages remain -- a load-more
  // row, being strictly older, always sorts after the boundary that rule
  // checks. Folding it into the hook itself is what makes the "already
  // loaded -> replace in place" path apply instead.
  const [extraPages, setExtraPages] = useState<readonly HistoryJobView[]>([]);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const { jobs, stalled } = useHistoryRefresh({
    initial: initial.items,
    additional: extraPages,
    sort: query.sort,
    dir: query.dir,
    filter: { status: query.status, statusBucket: query.statusBucket },
    style: query.style,
    includePrevious: query.includePrevious,
    hasMore: cursor !== null,
  });

  const handleLoadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    apiFetch(jobsLoadMoreUrl(query, cursor), {
      method: "GET",
      schema: historyJobsResponseSchema,
    })
      .then((page) => {
        setExtraPages((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        // Left in place for the reader to retry -- the button re-enables
        // below regardless of outcome, and the cursor/pages stay untouched
        // on failure so a retry resumes from exactly the same place.
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, query]);

  const isListEmpty = jobs.length === 0;
  const hasActiveFilter = hasActiveJobFilter(query);

  return (
    <div className="flex flex-col gap-4">
      <BrowserScopedNote />

      <FilterBar
        statusBucket={query.statusBucket}
        style={query.style}
        sort={query.sort}
        dir={query.dir}
        includePrevious={query.includePrevious}
        isListEmpty={isListEmpty}
      />

      {stalled ? (
        <p role="alert" className="text-sm text-destructive">
          We lost track of job updates. Reload the page to check the latest status.
        </p>
      ) : null}

      <HistoryEmptyState
        tab="transformations"
        rows={jobs}
        hasActiveFilter={hasActiveFilter}
        hasUploads={hasUploads}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
        clearFiltersHref="/history"
      />

      {isListEmpty ? null : (
        <ul aria-busy={loadingMore} className="flex flex-col gap-4">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-col gap-2">
              <HistoryCard job={job} cloudName={cloudName} />
              <PreviousAttempts attempts={job.attempts} cloudName={cloudName} />
            </li>
          ))}
        </ul>
      )}

      {/* F13: skeletons are aria-hidden, and paired with a visually hidden
          announcement -- shown only for a client-side load (load more),
          never on first paint, because the first page arrives server
          rendered. */}
      {loadingMore ? (
        <>
          <span role="status" className="sr-only">
            Loading history
          </span>
          <div aria-hidden className="flex flex-col gap-4">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </>
      ) : null}

      {!isListEmpty && cursor !== null ? (
        <Button
          type="button"
          variant="outline"
          onClick={handleLoadMore}
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

type SourcesPanelProps = {
  query: HistoryQueryInput;
  initial: HistorySourcesResponse;
  cloudName: string;
};

// The Uploads tab has no live-refresh concept of its own (sources are static
// once created), so this panel only ever needs its own pagination state --
// unlike TransformationsPanel, there is no separate refresh stream to fold
// load-more pages into.
function SourcesPanel({ query, initial, cloudName }: SourcesPanelProps) {
  const [sources, setSources] = useState<readonly SourceView[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleLoadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    apiFetch(sourcesLoadMoreUrl(query, cursor), {
      method: "GET",
      schema: historySourcesResponseSchema,
    })
      .then((page) => {
        setSources((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        // Same retry-in-place behaviour as the jobs panel above.
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, query]);

  return (
    <UploadsPanel
      sources={sources}
      cloudName={cloudName}
      hasMore={cursor !== null}
      onLoadMore={handleLoadMore}
      loadingMore={loadingMore}
    />
  );
}
