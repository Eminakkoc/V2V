import { uploadRequestSchema } from "@/lib/upload-contract";
import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { clientIp } from "@/server/services/client-ip";
import { resolveUserId } from "@/server/services/identity";
import { uploadSource } from "@/server/services/upload-source";
import { readJsonBody } from "@/server/validation/read-json-body";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withErrorHandling(async (request, hooks) => {
  const deps = getServerDeps();
  const userId = resolveUserId(request, deps.config.sessionCookieSecret, hooks);
  await deps.rateLimiter.check("upload", userId, clientIp(request));
  const body = await readJsonBody(request, uploadRequestSchema);
  return Response.json(await uploadSource(body, userId, deps));
});
