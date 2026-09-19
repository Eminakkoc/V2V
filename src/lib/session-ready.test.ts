import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSession, resetSessionForTests, sessionReady } from "./session-ready";

afterEach(() => {
  resetSessionForTests();
  vi.unstubAllGlobals();
});

describe("session bootstrap", () => {
  it("resolves immediately when no session call is pending", async () => {
    await expect(sessionReady()).resolves.toBeUndefined();
  });

  it("calls POST /api/session once and lets callers wait for it", async () => {
    let finish = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(
          (resolve) => (finish = () => resolve(new Response(null, { status: 204 }))),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    void ensureSession();
    void ensureSession();
    let ready = false;
    const waiting = sessionReady().then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    finish();
    await waiting;

    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/session", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("does not reject when the session call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(ensureSession()).resolves.toBeUndefined();
  });
});
