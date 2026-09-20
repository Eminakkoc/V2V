import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_WINDOW_SECONDS = 300;

type Result =
  { ok: true } | { ok: false; code: "WEBHOOK_INVALID_SIGNATURE" | "WEBHOOK_STALE_TIMESTAMP" };

const invalid: Result = { ok: false, code: "WEBHOOK_INVALID_SIGNATURE" };
const stale: Result = { ok: false, code: "WEBHOOK_STALE_TIMESTAMP" };

export function verifyWebhookSignature({
  rawBody,
  signature,
  timestamp,
  secret,
  nowSeconds,
}: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowSeconds: number;
}): Result {
  // Fail closed: a missing secret is a misconfiguration, never a pass.
  if (!secret || !signature || !timestamp) return invalid;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return stale;
  if (Math.abs(nowSeconds - sent) > TIMESTAMP_WINDOW_SECONDS) return stale;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on unequal lengths, so compare lengths first.
  if (a.length !== b.length) return invalid;
  return timingSafeEqual(a, b) ? { ok: true } : invalid;
}
