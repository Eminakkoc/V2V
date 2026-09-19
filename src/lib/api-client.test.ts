import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiFetch, toErrorLike } from "./api-client";

const schema = z.object({ id: z.string() });

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("posts JSON and returns parsed data", async () => {
    const fetchMock = stubFetch(Response.json({ id: "abc" }));
    await expect(apiFetch("/api/upload", { body: { cdnUrl: "x" }, schema })).resolves.toEqual({
      id: "abc",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/upload", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cdnUrl: "x" }),
      signal: undefined,
    });
  });

  it("throws a typed ApiError from the shared error shape", async () => {
    stubFetch(
      Response.json(
        { error: { code: "RATE_LIMITED", message: "Too many", retryable: true } },
        { status: 429, headers: { "Retry-After": "42" } },
      ),
    );
    const error = await apiFetch("/api/upload", { schema }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many",
      retryable: true,
      retryAfterSeconds: 42,
    });
  });

  it("turns a non-JSON error page into NETWORK_ERROR", async () => {
    stubFetch(new Response("<html>504</html>", { status: 504 }));
    await expect(apiFetch("/api/upload", { schema })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
      status: 504,
    });
  });

  it("turns a failed fetch into NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(apiFetch("/api/upload", { schema })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });

  it("treats an unexpected success body as NETWORK_ERROR", async () => {
    stubFetch(Response.json({ wrong: true }));
    await expect(apiFetch("/api/upload", { schema })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});

describe("toErrorLike", () => {
  it("keeps ApiError fields and wraps anything else", () => {
    const apiError = new ApiError({
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "Too big",
      retryable: false,
    });
    expect(toErrorLike(apiError)).toMatchObject({ code: "FILE_TOO_LARGE", retryable: false });
    expect(toErrorLike(new Error("boom"))).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });
});
