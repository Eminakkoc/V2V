import "server-only";
import type { AppConfig } from "@/config/env";
import { videoUrl } from "@/lib/cloudinary-urls";
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

// The depth at which a backwards retryOfJobId walk gives up rather than keep
// issuing batches. Typical chains are one or two deep; ten is headroom, not a
// realistic ceiling, so hitting it is worth a log line.
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
  // HistoryQuery on the repository is a discriminated union keyed on `sort`
  // so a duration cursor can never silently pair with the date branch (or
  // vice versa); query.sort is HistorySort, not a literal, so the branch has
  // to be spelled out rather than passed through.
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

  // One grouped count over the page's source ids, never one query per row.
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

// The only place the two per-row projections (source, attempts) are
// assembled, so every job-returning path -- first page, load more,
// changeable and ids -- goes through it and renders complete.
async function decorate(rows: Job[], userId: string, deps: Deps): Promise<HistoryJobView[]> {
  if (rows.length === 0) return [];

  const ancestorsById = await collectAttemptChains(rows, userId, deps.jobs);

  // Attempts share their parent's sourceId, so this is normally a no-op over
  // the rows' own ids -- collected anyway per the spec, in case a chain ever
  // does not share one.
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
    if (!warnedMissingSourceIds.has(row.sourceId)) {
      warnedMissingSourceIds.add(row.sourceId);
      console.warn(`[history] source ${row.sourceId} not found; falling back to job data`);
    }
    return fallbackProjection(row, deps.config);
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

// Walks retryOfJobId backwards in batches: one findByIds per depth level,
// collecting that level's retryOfJobId values for the next. Backwards
// because those ids are already in hand and `_id: {$in}` uses the primary
// index -- a forward walk on supersededByJobId would need an index that does
// not exist. Capped so a corrupt or cyclical chain cannot loop forever.
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

// A source record can vanish (or, in a test, simply never have existed)
// without the job that references it ceasing to exist. The row must still
// render, so this derives a best-effort projection from the one thing the
// job itself carries: its sourceId.
function fallbackProjection(row: Job, config: Pick<AppConfig, "cloudinary">) {
  return {
    cloudinaryPublicId: row.sourceId,
    cloudinaryUrl: videoUrl(config.cloudinary.cloudName, row.sourceId, "mp4"),
    duration: 0,
  };
}
