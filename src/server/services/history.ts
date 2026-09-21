import "server-only";
import type {
  HistoryJobsResponse,
  HistoryJobView,
  HistoryQueryInput,
  HistorySourcesResponse,
} from "@/lib/history-contract";
import { resolveStatuses } from "@/lib/history-filters";
import type { ServerDeps } from "@/server/deps";
import type { Job, JobsRepository } from "@/server/repositories/jobs";
import {
  decodeCursor,
  encodeDateCursor,
  encodeDurationCursor,
  type DurationCursor,
} from "@/server/services/history-cursor";
import { toJobView } from "@/server/services/job-view";

export { historyQuerySchema, parseHistoryQuery } from "@/lib/history-contract";

// Where a backwards retryOfJobId walk gives up; typical chains are one or two deep, so reaching
// this is worth a log line.
export const MAX_ATTEMPT_DEPTH = 10;

type Deps = Pick<ServerDeps, "jobs" | "sources" | "config">;

export async function listHistory(
  query: HistoryQueryInput,
  userId: string,
  deps: Deps,
  now: () => Date = () => new Date(),
): Promise<HistoryJobsResponse | HistorySourcesResponse> {
  if (query.tab === "sources") return listSources(query, userId, deps);

  const active = await deps.jobs.countActive(userId, now(), deps.config.jobGraceMinutes * 60_000);

  if (query.changeable) {
    const rows = await deps.jobs.listChangeable(userId);
    return { items: await decorate(rows, userId, deps), nextCursor: null, active };
  }
  if (query.ids) {
    const rows = await deps.jobs.findByIds(userId, query.ids);
    return { items: await decorate(rows, userId, deps), nextCursor: null, active };
  }

  const statuses = resolveStatuses(query);
  const base = {
    ...(statuses ? { statuses } : {}),
    artStyle: query.style,
    includePrevious: query.includePrevious,
    dir: query.dir,
    limit: query.limit + 1,
  };
  // query.sort is HistorySort rather than a literal, so the repository's discriminated union has to
  // be spelled out per branch.
  const rows =
    query.sort === "duration"
      ? await deps.jobs.listForUser(userId, {
          ...base,
          sort: "duration",
          cursor: query.cursor
            ? (decodeCursor(query.cursor, "duration") as DurationCursor)
            : undefined,
        })
      : await deps.jobs.listForUser(userId, {
          ...base,
          sort: "createdAt",
          cursor: query.cursor ? decodeCursor(query.cursor, "createdAt") : undefined,
        });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last
      ? query.sort === "duration"
        ? encodeDurationCursor(last)
        : encodeDateCursor(last)
      : null;
  return { items: await decorate(items, userId, deps), nextCursor, active };
}

async function listSources(
  query: HistoryQueryInput,
  userId: string,
  deps: Pick<ServerDeps, "jobs" | "sources">,
): Promise<HistorySourcesResponse> {
  const cursor = query.cursor ? decodeCursor(query.cursor, "createdAt") : undefined;
  const rows = await deps.sources.listForUser(userId, { limit: query.limit + 1, cursor });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeDateCursor(last) : null;

  const counts = await deps.jobs.countBySourceIds(
    userId,
    items.map((source) => source.id),
  );
  return {
    items: items.map((source) => ({
      id: source.id,
      cloudinaryPublicId: source.cloudinaryPublicId,
      cloudinaryUrl: source.cloudinaryUrl,
      format: source.format,
      duration: source.duration,
      width: source.width,
      height: source.height,
      bytes: source.bytes,
      createdAt: source.createdAt.toISOString(),
      transformCount: counts.get(source.id) ?? 0,
    })),
    nextCursor,
  };
}

// The only place the per-row source and attempts projections are assembled, so every job-returning
// path renders complete.
async function decorate(rows: Job[], userId: string, deps: Deps): Promise<HistoryJobView[]> {
  if (rows.length === 0) return [];

  const ancestorsById = await collectAttemptChains(rows, userId, deps.jobs);

  const sourceIds = new Set<string>();
  for (const row of rows) sourceIds.add(row.sourceId);
  for (const attempt of ancestorsById.values()) sourceIds.add(attempt.sourceId);
  const sourceRows = await deps.sources.findByIds(userId, [...sourceIds]);
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));

  const warnedMissingSourceIds = new Set<string>();
  function projectionFor(row: Job) {
    const source = sourceById.get(row.sourceId);
    if (source) {
      return {
        cloudinaryPublicId: source.cloudinaryPublicId,
        cloudinaryUrl: source.cloudinaryUrl,
        duration: source.duration,
      };
    }
    // There is nothing truthful to derive a projection from, and a synthesised URL would hand the
    // user a link to nothing; null still renders the rest of the row.
    if (!warnedMissingSourceIds.has(row.sourceId)) {
      warnedMissingSourceIds.add(row.sourceId);
      console.warn(`[history] source ${row.sourceId} not found; returning source: null`);
    }
    return null;
  }

  function chainFor(row: Job): Job[] {
    const chain: Job[] = [];
    const seen = new Set<string>([row.id]);
    let nextId = row.retryOfJobId;
    while (nextId && !seen.has(nextId)) {
      const ancestor = ancestorsById.get(nextId);
      if (!ancestor) break;
      seen.add(nextId);
      chain.push(ancestor);
      nextId = ancestor.retryOfJobId;
    }
    return chain.reverse();
  }

  return rows.map((row) => ({
    ...toJobView(row),
    source: projectionFor(row),
    attempts: chainFor(row).map(toJobView),
  }));
}

// Walks retryOfJobId backwards, one findByIds per depth level, because those ids already hit the
// primary index; capped so a cyclical chain cannot loop forever.
async function collectAttemptChains(
  rows: Job[],
  userId: string,
  jobs: Pick<JobsRepository, "findByIds">,
): Promise<Map<string, Job>> {
  const ancestorsById = new Map<string, Job>();
  let toFetch = new Set<string>();
  for (const row of rows) if (row.retryOfJobId) toFetch.add(row.retryOfJobId);

  for (let depth = 0; toFetch.size > 0; depth += 1) {
    if (depth >= MAX_ATTEMPT_DEPTH) {
      console.warn(
        `[history] attempt chain exceeded MAX_ATTEMPT_DEPTH (${MAX_ATTEMPT_DEPTH}); truncating`,
      );
      break;
    }
    const ids = [...toFetch].filter((id) => !ancestorsById.has(id));
    if (ids.length === 0) break;
    const fetched = await jobs.findByIds(userId, ids);
    const next = new Set<string>();
    for (const job of fetched) {
      ancestorsById.set(job.id, job);
      if (job.retryOfJobId) next.add(job.retryOfJobId);
    }
    toFetch = next;
  }
  return ancestorsById;
}
