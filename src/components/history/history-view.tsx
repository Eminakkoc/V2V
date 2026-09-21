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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryEmptyState } from "./empty-states";
import { FilterBar } from "./filter-bar";
import { HistoryCard } from "./history-card";
import { HistoryTabs } from "./history-tabs";
import { PreviousAttempts } from "./previous-attempts";
import { UploadsPanel } from "./uploads-panel";

// Loaded via `load more`, one page at a time and never through URL navigation, so this is genuinely
// client-only state.
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

// The page keys this component on the serialized search params, so a filter, sort or tab navigation
// remounts it -- that remount is the "restart from the first page" requirement, which is why there
// is no reset effect here to get wrong.
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
  // Handed to useHistoryRefresh as `additional` rather than merged here, so the hook's own tracked
  // list includes them and a status change replaces the row in place instead of being deferred by
  // the insertion-window rule.
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
        // Left in place for the reader to retry: the cursor and pages stay untouched on failure, so
        // a retry resumes from exactly the same place.
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, query]);

  const isListEmpty = jobs.length === 0;
  const hasActiveFilter = hasActiveJobFilter(query);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
      <FilterBar
        statusBucket={query.statusBucket}
        style={query.style}
        sort={query.sort}
        dir={query.dir}
        isListEmpty={isListEmpty}
      />

      {stalled ? (
        <Alert role="alert">
          <AlertDescription>
            We lost track of job updates. Reload the page to check the latest status.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The one scrolling box on the page, so the filter row above it never
          leaves; the inset padding keeps card shadows and focus rings from
          being clipped against its edges. `relative` is load-bearing: the
          cards' visually hidden live regions are position:absolute, and
          without a containing block here they escape the clip and stretch the
          document back into a page scroll. */}
      <div
        data-slot="history-scroll"
        className="relative -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 sm:gap-6"
      >
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
          <ul aria-busy={loadingMore} className="flex flex-col gap-4 sm:gap-6">
            {jobs.map((job) => (
              // The panel lives here, not on HistoryCard: the attempts disclosure is part of the same
              // card and has to sit inside it.
              <li key={job.id} className="flex flex-col rounded-card bg-surface shadow-sm">
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
            <div aria-hidden className="flex flex-col gap-4 sm:gap-6">
              <Skeleton className="h-[172px] w-full rounded-card" />
              <Skeleton className="h-[172px] w-full rounded-card" />
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
            className="self-center"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type SourcesPanelProps = {
  query: HistoryQueryInput;
  initial: HistorySourcesResponse;
  cloudName: string;
};

// Sources are static once created, so this panel only ever needs its own pagination state -- there
// is no refresh stream to fold load-more pages into.
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
      .catch(() => {})
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
