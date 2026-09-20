import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { listHistory, parseHistoryQuery } from "@/server/services/history";
import { resolveUserId } from "@/server/services/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withErrorHandling(async (request, hooks) => {
  const deps = getServerDeps();
  const userId = resolveUserId(request, deps.config.sessionCookieSecret, hooks);
  const query = parseHistoryQuery(
    Object.fromEntries(new URL(request.url).searchParams) as Record<string, string>,
  );
  return Response.json(await listHistory(query, userId, deps), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
