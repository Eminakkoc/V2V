// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { createVideoRules } from "@/lib/video-rules";
import { useSourceUpload } from "./use-source-upload";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const rules = createVideoRules({ allowedFormats: ["video/mp4"], maxBytes: 100 });
const cdnUrl = "https://ucarecdn.com/3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a/";
const result = {
  sourceId: "s1",
  sourceVideo: {
    cloudinaryPublicId: "sources/a",
    cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/sources/a.mp4",
    format: "mp4",
    bytes: 50,
    duration: 3,
    width: 640,
    height: 360,
  },
  posterUrl: "https://res.cloudinary.com/demo/video/upload/so_0/sources/a.jpg",
};
const storingFailed = () =>
  new ApiError({ status: 502, code: "CLOUDINARY_UPLOAD_FAILED", message: "x", retryable: true });

beforeEach(() => fetchMock.mockReset());

describe("useSourceUpload", () => {
  it("refuses an oversize file before any upload", () => {
    const { result: hook } = renderHook(() => useSourceUpload(rules));
    let accepted = true;
    act(() => {
      accepted = hook.current.select({ name: "big.mp4", mimeType: "video/mp4", size: 101 });
    });
    expect(accepted).toBe(false);
    expect(hook.current.state).toEqual({
      status: "rejected",
      error: { code: "FILE_TOO_LARGE", message: "", retryable: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tracks progress, then stores and becomes ready", async () => {
    fetchMock.mockResolvedValueOnce(result);
    const { result: hook } = renderHook(() => useSourceUpload(rules));
    act(() => void hook.current.select({ name: "a.mp4", mimeType: "video/mp4", size: 50 }));
    act(() => hook.current.progress(42.4));
    expect(hook.current.state).toEqual({ status: "uploading", progress: 42 });
    act(() => hook.current.uploaded(cdnUrl));
    expect(hook.current.state).toEqual({ status: "storing" });
    await waitFor(() => expect(hook.current.state).toEqual({ status: "ready", result }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/upload",
      expect.objectContaining({ body: { cdnUrl } }),
    );
  });

  it("ignores late progress events once storing has started", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const { result: hook } = renderHook(() => useSourceUpload(rules));
    act(() => void hook.current.select({ name: "a.mp4", mimeType: "video/mp4", size: 50 }));
    act(() => hook.current.uploaded(cdnUrl));
    act(() => hook.current.progress(100));
    expect(hook.current.state).toEqual({ status: "storing" });
  });

  it("reports a server failure and retries with the same upload", async () => {
    const onServerError = vi.fn();
    fetchMock.mockRejectedValueOnce(storingFailed()).mockResolvedValueOnce(result);
    const { result: hook } = renderHook(() => useSourceUpload(rules, { onServerError }));
    act(() => void hook.current.select({ name: "a.mp4", mimeType: "video/mp4", size: 50 }));
    act(() => hook.current.uploaded(cdnUrl));
    await waitFor(() => expect(hook.current.state.status).toBe("failed"));
    expect(onServerError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CLOUDINARY_UPLOAD_FAILED" }),
    );
    act(() => hook.current.retry());
    await waitFor(() => expect(hook.current.state.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ body: { cdnUrl } });
  });

  it("explains a failed browser upload with the signature error when there was one", () => {
    const { result: hook } = renderHook(() => useSourceUpload(rules));
    act(() => void hook.current.select({ name: "a.mp4", mimeType: "video/mp4", size: 50 }));
    act(() =>
      hook.current.signatureFailed({
        code: "RATE_LIMITED",
        message: "x",
        retryable: true,
        retryAfterSeconds: 30,
      }),
    );
    act(() => hook.current.uploadFailed());
    expect(hook.current.state).toMatchObject({
      status: "rejected",
      error: { code: "RATE_LIMITED" },
    });
  });

  it("falls back to UPLOAD_INTERRUPTED for other browser upload failures", () => {
    const { result: hook } = renderHook(() => useSourceUpload(rules));
    act(() => void hook.current.select({ name: "a.mp4", mimeType: "video/mp4", size: 50 }));
    act(() => hook.current.uploadFailed());
    expect(hook.current.state).toMatchObject({
      status: "rejected",
      error: { code: "UPLOAD_INTERRUPTED" },
    });
  });

  it("drops a response that arrives after a reset", async () => {
    let resolve: (value: typeof result) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const { result: hook } = renderHook(() => useSourceUpload(rules));
    act(() => void hook.current.select({ name: "a.mp4", mimeType: "video/mp4", size: 50 }));
    act(() => hook.current.uploaded(cdnUrl));
    act(() => hook.current.reset());
    await act(async () => resolve(result));
    expect(hook.current.state).toEqual({ status: "idle" });
  });
});
