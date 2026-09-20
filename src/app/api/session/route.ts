import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { resolveUserId } from "@/server/services/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = withErrorHandling(async (request, hooks) => {
  resolveUserId(request, getServerDeps().config.sessionCookieSecret, hooks);
  // 204, not 200: the cookie is the entire answer, and there is no body to send.
  return new Response(null, { status: 204 });
});
