import { cookies } from "next/headers";
import { after } from "next/server";
import { HistoryView } from "@/components/history/history-view";
import type {
  HistoryJobsResponse,
  HistoryQueryInput,
  HistorySourcesResponse,
} from "@/lib/history-contract";
import { getServerDeps } from "@/server/deps";
import { listHistory, parseHistoryQuery } from "@/server/services/history";
import { IDENTITY_COOKIE, verifyIdentity } from "@/server/services/identity";
import { scheduleReconciliation } from "@/server/services/reconcile";

// Next represents a repeated query key as an array; historyQuerySchema takes one string per key, so
// a repeat collapses to its last occurrence.
function flatten(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    flat[key] = Array.isArray(value) ? (value.at(-1) ?? "") : value;
  }
  return flat;
}

// listHistory's return type is a union regardless of the query, so the tab it was asked for is what
// narrows it -- "active" is present on the jobs shape and absent on the sources one.
function isJobsResponse(
  data: HistoryJobsResponse | HistorySourcesResponse,
): data is HistoryJobsResponse {
  return "active" in data;
}

function emptyJobsResponse(): HistoryJobsResponse {
  return {
    items: [],
    nextCursor: null,
    active: { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 },
  };
}

function emptySourcesResponse(): HistorySourcesResponse {
  return { items: [], nextCursor: null };
}

// A ZodError is right for the API route's 400, but here it would land on error.tsx and blame the
// service for a link that is merely out of date, so a malformed query falls back to the defaults.
function parseHistoryQueryOrDefault(raw: Record<string, string>): HistoryQueryInput {
  try {
    return parseHistoryQuery(raw);
  } catch {
    return parseHistoryQuery({});
  }
}

async function hasAnyUploads(
  userId: string | undefined,
  query: HistoryQueryInput,
  deps: ReturnType<typeof getServerDeps>,
): Promise<boolean> {
  if (!userId || query.tab === "sources") return false;
  const sources = await deps.sources.listForUser(userId, { limit: 1 });
  return sources.length > 0;
}

type HistoryPanelProps = {
  // The promise, not its value, so nothing above this boundary awaits a dynamic API and the page
  // header can render as part of the static shell.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The data-dependent half of the History page, suspended by the page above so only this part waits
// behind a skeleton.
export async function HistoryPanel({ searchParams }: HistoryPanelProps) {
  const deps = getServerDeps();
  const raw = flatten(await searchParams);
  const query = parseHistoryQueryOrDefault(raw);
  const userId = verifyIdentity(
    (await cookies()).get(IDENTITY_COOKIE)?.value,
    deps.config.sessionCookieSecret,
  )?.userId;

  // Two independent reads, so they go out together rather than one after the other.
  const [data, hasUploads] = await Promise.all([
    userId
      ? listHistory(query, userId, deps)
      : query.tab === "sources"
        ? emptySourcesResponse()
        : emptyJobsResponse(),
    hasAnyUploads(userId, query, deps),
  ]);

  // Read during render and closed over: a Server Component that called cookies() inside after()
  // would throw at runtime.
  if (userId) after(() => scheduleReconciliation(userId, deps));

  // Keys the client shell on the serialized search params, so a filter, sort or tab change remounts
  // HistoryView -- the entire "restart from the first page" mechanism.
  const key = new URLSearchParams(raw).toString();
  const cloudName = deps.config.cloudinary.cloudName;

  return isJobsResponse(data) ? (
    <HistoryView
      key={key}
      tab="jobs"
      query={query}
      initial={data}
      hasUploads={hasUploads}
      cloudName={cloudName}
    />
  ) : (
    <HistoryView key={key} tab="sources" query={query} initial={data} cloudName={cloudName} />
  );
}
