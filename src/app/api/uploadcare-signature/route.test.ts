import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uploadSignatureSchema } from "@/lib/upload-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import { createFakeProviders } from "@/server/providers/fakes";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { apiRequest, cookieValue, identityCookie } from "@/test/requests";
import { POST } from "./route";

const { getDb } = setupTestDb();
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(async () => {
  await (await getDb()).collection("rateLimitHits").deleteMany({});
  setServerDepsForTests(
    buildServerDeps(testConfig, { getDb, providers: createFakeProviders("test-cloud") }),
  );
});
afterEach(() => setServerDepsForTests(undefined));

describe("POST /api/uploadcare-signature", () => {
  it("returns a signature valid for 30 minutes, signed with the secret key", async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await POST(
      apiRequest("/api/uploadcare-signature", { cookie: identityCookie(userId) }),
    );
    expect(response.status).toBe(200);
    const body = uploadSignatureSchema.parse(await response.json());
    const expire = Number(body.secureExpire);
    expect(expire - before).toBeGreaterThanOrEqual(1799);
    expect(expire - before).toBeLessThanOrEqual(1801);
    const expected = createHmac("sha256", testConfig.uploadcare.secretKey)
      .update(body.secureExpire)
      .digest("hex");
    expect(body.secureSignature).toBe(expected);
    expect(JSON.stringify(body)).not.toContain(testConfig.uploadcare.secretKey);
  });

  it("creates an identity when the cookie is missing", async () => {
    const response = await POST(apiRequest("/api/uploadcare-signature"));
    expect(cookieValue(response)).toBeDefined();
  });

  it("rate limits signatures on their own counter", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await POST(apiRequest("/api/uploadcare-signature", { cookie: identityCookie(userId) })))
          .status,
      ).toBe(200);
    }
    const limited = await POST(
      apiRequest("/api/uploadcare-signature", { cookie: identityCookie(userId) }),
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
