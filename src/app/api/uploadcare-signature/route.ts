import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { clientIp } from "@/server/services/client-ip";
import { resolveUserId } from "@/server/services/identity";
import { createUploadSignature } from "@/server/services/upload-signature";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = withErrorHandling(async (request, hooks) => {
  const { config, rateLimiter } = getServerDeps();
  const userId = resolveUserId(request, config.sessionCookieSecret, hooks);
  await rateLimiter.check("signature", userId, clientIp(request));
  return Response.json(createUploadSignature(config.uploadcare.secretKey));
});
