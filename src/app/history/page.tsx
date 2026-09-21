import type { Metadata } from "next";
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

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "History" };

type HistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Next 16 represents a repeated query key as an array; historyQuerySchema
// (like the API route's own parsing) takes one string per key, so a repeat
// collapses to its last occurrence rather than being rejected outright.
function flatten(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    flat[key] = Array.isArray(value) ? (value.at(-1) ?? "") : value;
  }
  return flat;
}

// listHistory's return type is a union regardless of the query it was given,
// so the tab it was actually asked for is what narrows it here -- "active"
// is present on the jobs shape and absent on the sources one (pinned by
// src/app/api/history/route.test.ts's own "not.toHaveProperty('active')"
// check), which makes this a real runtime narrow, not just an assertion.
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

// parseHistoryQuery throws a ZodError on a malformed query (an unknown
// status, an out-of-range limit, a forbidden combination, ...). That is
// correct for the API route, which turns it into a clean 400, but this is a
// Server Component render: an uncaught throw here lands on src/app/error.tsx
// ("The service is unavailable or had a problem"), which is the wrong
// message for a hand-edited or stale shared link -- the service is fine, the
// link is just out of date. Falling back to the same defaults an empty query
// string would produce renders the page normally instead.
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

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const deps = getServerDeps();
  const raw = flatten(await searchParams);
  const query = parseHistoryQueryOrDefault(raw);
  const userId = verifyIdentity(
    (await cookies()).get(IDENTITY_COOKIE)?.value,
    deps.config.sessionCookieSecret,
  )?.userId;

  const data = userId
    ? await listHistory(query, userId, deps)
    : query.tab === "sources"
      ? emptySourcesResponse()
      : emptyJobsResponse();

  // Read during render, closed over here. A Server Component that called
  // cookies() INSIDE after() would throw at runtime -- see
  // node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md.
  if (userId) after(() => scheduleReconciliation(userId, deps));

  const hasUploads = await hasAnyUploads(userId, query, deps);

  // Keys the client shell on the serialized search params: a filter, sort,
  // tab or include-previous navigation changes this string, which remounts
  // HistoryView and is the entire "restart from the first page" mechanism --
  // there is no separate reset path to call, and so none to forget to call.
  const key = new URLSearchParams(raw).toString();
  const cloudName = deps.config.cloudinary.cloudName;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">History</h1>
      {isJobsResponse(data) ? (
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
      )}
    </div>
  );
}
