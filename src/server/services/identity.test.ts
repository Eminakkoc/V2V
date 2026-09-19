import { describe, expect, it } from "vitest";
import { hasFreshIdentity, signIdentity, verifyIdentity } from "./identity";

const secret = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const now = 1_800_000_000;
const day = 24 * 60 * 60;

describe("identity cookie signing", () => {
  it("round-trips a signed value", () => {
    expect(verifyIdentity(signIdentity(userId, now, secret), secret)).toEqual({
      userId,
      issuedAt: now,
    });
  });

  it("rejects a value signed with another secret", () => {
    expect(verifyIdentity(signIdentity(userId, now, "b3RoZXItc2VjcmV0"), secret)).toBeNull();
  });

  it("rejects a swapped user id", () => {
    const [, issuedAt, signature] = signIdentity(userId, now, secret).split(".");
    const forged = `6f9619ff-8b86-4d01-b42d-00cf4fc964ff.${issuedAt}.${signature}`;
    expect(verifyIdentity(forged, secret)).toBeNull();
  });

  it.each([undefined, "", "abc", "a.b.c", `${userId}.x.sig`, `${userId}.${now}`])(
    "rejects malformed value %j",
    (value) => expect(verifyIdentity(value, secret)).toBeNull(),
  );

  it("is fresh for 30 days and due for renewal after that", () => {
    expect(hasFreshIdentity(signIdentity(userId, now, secret), secret, now + 30 * day)).toBe(true);
    expect(hasFreshIdentity(signIdentity(userId, now, secret), secret, now + 30 * day + 1)).toBe(
      false,
    );
    expect(hasFreshIdentity(undefined, secret, now)).toBe(false);
  });
});
