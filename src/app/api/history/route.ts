import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { historyQuerySchema, listHistory } from "@/server/services/history";
import { resolveUserId } from "@/server/services/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withErrorHandling(async (request, hooks) => {
  const deps = getServerDeps();
  const userId = resolveUserId(request, deps.config.sessionCookieSecret, hooks);
  const query = historyQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(await listHistory(query, userId, deps), {
    headers: { "Cache-Control": "private, no-store" },
  });
});
