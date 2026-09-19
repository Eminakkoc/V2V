import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { resolveUserId } from "@/server/services/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const preferredRegion = "fra1";

export const POST = withErrorHandling(async (request, hooks) => {
  resolveUserId(request, getServerDeps().config.sessionCookieSecret, hooks);
  return new Response(null, { status: 204 });
});
