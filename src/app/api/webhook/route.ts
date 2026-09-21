import { getServerDeps } from "@/server/deps";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { handleWebhookEvent } from "@/server/services/webhook-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// No cookie and no rate limiter: Magic Hour is not a browser, and rate limiting its retries would
// cause the very losses those retries prevent.
export const POST = withErrorHandling(async (request) => {
  const deps = getServerDeps();
  // The raw body must be read before anything parses it: re-serialising a parsed body changes the
  // bytes and the HMAC will not match.
  const rawBody = await request.text();
  const { status, body } = await handleWebhookEvent(
    rawBody,
    {
      signature: request.headers.get("magic-hour-event-signature"),
      timestamp: request.headers.get("magic-hour-event-timestamp"),
    },
    deps,
  );
  return Response.json(body, { status });
});
