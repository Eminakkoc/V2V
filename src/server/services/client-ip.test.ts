import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("uses the x-real-ip header Vercel sets", () => {
    const request = new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.7" } });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to one local bucket and ignores x-forwarded-for", () => {
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(clientIp(request)).toBe("local");
  });
});
