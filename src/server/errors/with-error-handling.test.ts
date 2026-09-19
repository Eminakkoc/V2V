import { notFound } from "next/navigation";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "./app-error";
import { withErrorHandling } from "./with-error-handling";

const request = () => new NextRequest("http://localhost/api/test", { method: "POST" });

describe("withErrorHandling", () => {
  it("returns the handler's response", async () => {
    const handler = withErrorHandling(async () => Response.json({ ok: true }));
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("turns an AppError into its status and the shared shape", async () => {
    const handler = withErrorHandling(async () => {
      throw new AppError("FILE_TOO_LARGE");
    });
    const response = await handler(request());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "FILE_TOO_LARGE",
        message: "The video is larger than the allowed size.",
        retryable: false,
      },
    });
  });

  it("lets a single error override retryable and add details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new AppError("CLOUDINARY_UPLOAD_FAILED", {
        retryable: false,
        details: { reason: "unreadable" },
      });
    });
    const body = await (await handler(request())).json();
    expect(body.error).toMatchObject({
      code: "CLOUDINARY_UPLOAD_FAILED",
      retryable: false,
      details: { reason: "unreadable" },
    });
  });

  it("adds Retry-After to rate-limited responses", async () => {
    const handler = withErrorHandling(async () => {
      throw new AppError("RATE_LIMITED", { retryAfterSeconds: 42 });
    });
    const response = await handler(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("maps Zod errors to VALIDATION_FAILED with field paths", async () => {
    const handler = withErrorHandling(async () => {
      z.object({ cdnUrl: z.string() }).parse({});
      return Response.json({});
    });
    const response = await handler(request());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields[0].path).toBe("cdnUrl");
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new Error("secret-token leaked in message");
    });
    const response = await handler(request());
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain('"code":"INTERNAL"');
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("at ");
    expect(log).toHaveBeenCalled();
  });

  it("rethrows Next.js control-flow errors", async () => {
    const handler = withErrorHandling(async () => notFound());
    await expect(handler(request())).rejects.toThrow();
  });

  it("runs response hooks on success and on errors", async () => {
    const ok = withErrorHandling(async (_request, hooks) => {
      hooks.onResponse((response) => response.headers.set("X-Hook", "ran"));
      return Response.json({});
    });
    const failing = withErrorHandling(async (_request, hooks) => {
      hooks.onResponse((response) => response.headers.set("X-Hook", "ran"));
      throw new AppError("RATE_LIMITED");
    });
    expect((await ok(request())).headers.get("X-Hook")).toBe("ran");
    expect((await failing(request())).headers.get("X-Hook")).toBe("ran");
  });
});
