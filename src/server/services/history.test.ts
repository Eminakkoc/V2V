import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { historyQuerySchema, parseHistoryQuery } from "./history";

const request = () => new NextRequest("http://localhost/api/history", { method: "GET" });

describe("history service re-exports", () => {
  it("re-exports historyQuerySchema and parseHistoryQuery from the shared contract", () => {
    expect(historyQuerySchema.parse({})).toMatchObject({ tab: "jobs" });
    expect(() => parseHistoryQuery({ tab: "sources", status: "complete" })).toThrow(ZodError);
  });

  // parseHistoryQuery throws a ZodError, never an AppError, so it can live in
  // src/lib (no server-only import) and still be parsed by the browser. Prove
  // that ZodError survives src/server/errors/with-error-handling.ts's mapping
  // to VALIDATION_FAILED exactly the way a schema failure would, the same
  // pattern that module's own test suite uses for a plain schema failure.
  it("maps a raw-presence rejection to VALIDATION_FAILED with field paths", async () => {
    const handler = withErrorHandling(async () => {
      parseHistoryQuery({ tab: "sources", status: "complete", dir: "asc" });
      return Response.json({});
    });
    const response = await handler(request());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields).toEqual(
      expect.arrayContaining([
        { path: "status", message: "cannot be combined with tab=sources" },
        { path: "dir", message: "cannot be combined with tab=sources" },
      ]),
    );
  });
});
