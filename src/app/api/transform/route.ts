import { transformRequestSchema } from "@/lib/transform-contract";
import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { clientIp } from "@/server/services/client-ip";
import { resolveUserId } from "@/server/services/identity";
import { startTransform } from "@/server/services/transform";
import { readJsonBody } from "@/server/validation/read-json-body";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withErrorHandling(async (request, hooks) => {
  const deps = getServerDeps();
  const userId = resolveUserId(request, deps.config.sessionCookieSecret, hooks);
  await deps.rateLimiter.check("transform", userId, clientIp(request));
  const body = await readJsonBody(request, transformRequestSchema);
  return Response.json(await startTransform(body, userId, deps), { status: 202 });
});
