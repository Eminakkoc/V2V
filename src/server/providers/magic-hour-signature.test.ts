import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./magic-hour-signature";

const secret = "test-webhook-secret";
const rawBody = JSON.stringify({ type: "video.completed", payload: { id: "mh-1" } });
const nowSeconds = 1_758_000_000;

const sign = (timestamp: string, body: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");

const verify = (over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({
    rawBody,
    timestamp: String(nowSeconds),
    signature: sign(String(nowSeconds), rawBody),
    secret,
    nowSeconds,
    ...over,
  });

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed, fresh delivery", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("rejects a body altered after signing", () => {
    expect(verify({ rawBody: `${rawBody} ` })).toEqual({
      ok: false,
      code: "WEBHOOK_INVALID_SIGNATURE",
    });
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verify({ signature: createHmac("sha256", "other").update("x").digest("hex") })).toEqual({
      ok: false,
      code: "WEBHOOK_INVALID_SIGNATURE",
    });
  });

  it("rejects a replay outside the window, in both directions", () => {
    const old = String(nowSeconds - 301);
    expect(verify({ timestamp: old, signature: sign(old, rawBody) })).toEqual({
      ok: false,
      code: "WEBHOOK_STALE_TIMESTAMP",
    });
    const future = String(nowSeconds + 301);
    expect(verify({ timestamp: future, signature: sign(future, rawBody) })).toEqual({
      ok: false,
      code: "WEBHOOK_STALE_TIMESTAMP",
    });
  });

  it("fails closed on missing headers or a missing secret", () => {
    expect(verify({ signature: null }).ok).toBe(false);
    expect(verify({ timestamp: null }).ok).toBe(false);
    expect(verify({ secret: "" }).ok).toBe(false);
  });

  it("fails closed on a non-numeric timestamp", () => {
    expect(verify({ timestamp: "soon" })).toEqual({
      ok: false,
      code: "WEBHOOK_STALE_TIMESTAMP",
    });
  });

  it("does not throw when signature lengths differ", () => {
    // timingSafeEqual throws on unequal lengths; the guard must precede it.
    expect(() => verify({ signature: "abc" })).not.toThrow();
    expect(verify({ signature: "abc" }).ok).toBe(false);
  });
});
