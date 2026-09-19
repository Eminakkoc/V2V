import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import { verifyIdentity } from "@/server/services/identity";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { apiRequest, cookieValue, identityCookie } from "@/test/requests";
import { POST } from "./route";

const { getDb } = setupTestDb();
const secret = testConfig.sessionCookieSecret;
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => setServerDepsForTests(buildServerDeps(testConfig, { getDb })));
afterEach(() => setServerDepsForTests(undefined));

describe("POST /api/session", () => {
  it("issues a signed, HttpOnly, Lax, one-year cookie on first visit", async () => {
    const response = await POST(apiRequest("/api/session"));
    expect(response.status).toBe(204);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Max-Age=31536000/);
    expect(header).not.toMatch(/Secure/);
    expect(verifyIdentity(cookieValue(response), secret)).not.toBeNull();
  });

  it("marks the cookie Secure outside localhost", async () => {
    const response = await POST(apiRequest("/api/session", { origin: "https://v2v.example" }));
    expect(response.headers.get("set-cookie")).toMatch(/Secure/);
  });

  it("keeps a fresh cookie untouched", async () => {
    const response = await POST(apiRequest("/api/session", { cookie: identityCookie(userId) }));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("renews a cookie older than 30 days with the same user id", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    const response = await POST(
      apiRequest("/api/session", { cookie: identityCookie(userId, issuedAt) }),
    );
    expect(verifyIdentity(cookieValue(response), secret)?.userId).toBe(userId);
  });

  it("replaces a tampered cookie with a new user id", async () => {
    const response = await POST(
      apiRequest("/api/session", { cookie: `v2v_uid=${userId}.1.forged` }),
    );
    const renewed = verifyIdentity(cookieValue(response), secret);
    expect(renewed).not.toBeNull();
    expect(renewed?.userId).not.toBe(userId);
  });
});
