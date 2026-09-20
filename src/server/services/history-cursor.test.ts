import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors/app-error";
import { decodeCursor, encodeDateCursor, encodeDurationCursor } from "./history-cursor";

const id = "65f000000000000000000001";
const createdAt = new Date("2026-09-20T10:00:00.000Z");

function expectInvalid(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_FAILED");
    return;
  }
  throw new Error("expected decodeCursor to throw");
}

describe("history cursors", () => {
  it("keeps the shipped date payload shape", () => {
    const raw = encodeDateCursor({ createdAt, id });
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    expect(decoded).toEqual({ createdAt: createdAt.toISOString(), id });
  });

  it("round-trips a date cursor", () => {
    expect(decodeCursor(encodeDateCursor({ createdAt, id }), "createdAt")).toEqual({
      createdAt,
      id,
    });
  });

  it("round-trips a duration cursor carrying the full ordering tuple", () => {
    const raw = encodeDurationCursor({
      params: { startSeconds: 1.5, endSeconds: 6.75 },
      createdAt,
      id,
    });
    expect(decodeCursor(raw, "duration")).toEqual({ clipSeconds: 5.25, createdAt, id });
  });

  it("rejects a date cursor sent with the duration sort", () => {
    const raw = encodeDateCursor({ createdAt, id });
    expectInvalid(() => decodeCursor(raw, "duration"));
  });

  it("rejects a duration cursor sent with the date sort", () => {
    const raw = encodeDurationCursor({
      params: { startSeconds: 0, endSeconds: 3 },
      createdAt,
      id,
    });
    expectInvalid(() => decodeCursor(raw, "createdAt"));
  });

  it("rejects malformed base64, malformed json and a bad object id", () => {
    expectInvalid(() => decodeCursor("!!!not-base64!!!", "createdAt"));
    expectInvalid(() => decodeCursor(Buffer.from("nope").toString("base64url"), "createdAt"));
    expectInvalid(() =>
      decodeCursor(
        Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id: "zz" })).toString(
          "base64url",
        ),
        "createdAt",
      ),
    );
  });

  it("rejects an unparseable date", () => {
    expectInvalid(() =>
      decodeCursor(
        Buffer.from(JSON.stringify({ createdAt: "not-a-date", id })).toString("base64url"),
        "createdAt",
      ),
    );
  });
});
