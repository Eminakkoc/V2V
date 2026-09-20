// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadState } from "@/hooks/use-source-upload";
import { useJobPolling } from "@/hooks/use-job-polling";
import { ApiError, apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import type { JobView } from "@/lib/transform-contract";
import type { UploadResponse } from "@/lib/upload-contract";
import type { SourceUploaderProps } from "@/components/upload/source-uploader";
import { CreateFlow, type CreateFlowSettings } from "./create-flow";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch: vi.fn(),
}));

vi.mock("@/hooks/use-job-polling", () => ({ useJobPolling: vi.fn() }));

// The uploader widget wraps a third-party web component with no test
// coverage of its own; CreateFlow only depends on the callbacks it invokes,
// so a stub captures them instead of driving the real Uploadcare widget.
const captured = vi.hoisted(() => ({ props: undefined as SourceUploaderProps | undefined }));

vi.mock("@/components/upload/source-uploader", () => ({
  SourceUploader: (props: SourceUploaderProps) => {
    captured.props = props;
    return <div data-testid="source-uploader-stub" />;
  },
}));

const fetchMock = vi.mocked(apiFetch);
const useJobPollingMock = vi.mocked(useJobPolling);

const settings: CreateFlowSettings = {
  publicKey: "demo-key",
  allowedFormats: ["video/mp4"],
  maxBytes: 100_000_000,
  maxClipSeconds: 30,
  cloudName: "demo",
};

const uploadResult: UploadResponse = {
  sourceId: "source-1",
  sourceVideo: {
    cloudinaryPublicId: "sources/a",
    cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/sources/a.mp4",
    format: "mp4",
    bytes: 1_000,
    duration: 10,
    width: 1280,
    height: 720,
  },
  posterUrl: "https://res.cloudinary.com/demo/video/upload/so_0/sources/a.jpg",
};

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    sourceId: "source-1",
    status: "processing",
    phase: "queued",
    params: {
      name: "clip.mp4",
      startSeconds: 0,
      endSeconds: 10,
      fpsResolution: "HALF",
      artStyle: "No Art Style",
      promptType: "default",
      model: "default",
      version: "default",
    },
    createdAt: "2026-09-20T00:00:00.000Z",
    deadlineAt: "2026-09-20T01:00:00.000Z",
    ...overrides,
  };
}

function selectAndReady(name = "clip.mp4", result: UploadResponse = uploadResult) {
  act(() => captured.props?.onFileSelected?.(name));
  const ready: UploadState = { status: "ready", result };
  act(() => captured.props?.onStateChange?.(ready));
}

beforeEach(() => {
  captured.props = undefined;
  fetchMock.mockReset();
  useJobPollingMock.mockReset();
  useJobPollingMock.mockReturnValue({
    jobs: [],
    refresh: vi.fn(),
    insertOptimistic: vi.fn(),
    error: false,
    stalled: false,
  });
});

describe("CreateFlow", () => {
  it("shows neither the trimmer nor the options form before an upload", () => {
    render(<CreateFlow settings={settings} />);
    expect(screen.queryByRole("slider", { name: "Clip start" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Art style" })).not.toBeInTheDocument();
  });

  it("shows the preview, trimmer and options form once a source is ready", () => {
    render(<CreateFlow settings={settings} />);
    selectAndReady();
    expect(screen.getByRole("slider", { name: "Clip start" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Art style" })).toBeInTheDocument();
  });

  it("takes the trimmer's bounds from the uploaded source's real duration", () => {
    render(<CreateFlow settings={settings} />);
    selectAndReady("clip.mp4", {
      ...uploadResult,
      sourceVideo: { ...uploadResult.sourceVideo, duration: 42 },
    });
    expect(screen.getByRole("spinbutton", { name: "Clip end" })).toHaveAttribute("max", "42");
  });

  it("defaults the job name to the uploaded file's name", () => {
    render(<CreateFlow settings={settings} />);
    selectAndReady("holiday.mov");
    expect(screen.getByRole("textbox", { name: "Job name" })).toHaveValue("holiday.mov");
  });

  it("posts once and inserts the returned job optimistically", async () => {
    const insertOptimistic = vi.fn();
    useJobPollingMock.mockReturnValue({
      jobs: [],
      refresh: vi.fn(),
      insertOptimistic,
      error: false,
      stalled: false,
    });
    const created = job();
    fetchMock.mockResolvedValueOnce({ job: created });

    render(<CreateFlow settings={settings} />);
    selectAndReady();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Transform" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transform",
      expect.objectContaining({
        body: expect.objectContaining({
          sourceId: "source-1",
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      }),
    );
    expect(insertOptimistic).toHaveBeenCalledWith(created);
  });

  it("disables the Transform button while a submit is in flight", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<CreateFlow settings={settings} />);
    selectAndReady();

    const button = screen.getByRole("button", { name: "Transform" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toBeDisabled();
  });

  it("does not post twice when clicked again while a submit is in flight", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<CreateFlow settings={settings} />);
    selectAndReady();

    const button = screen.getByRole("button", { name: "Transform" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server error and re-enables the button", async () => {
    fetchMock.mockRejectedValueOnce(
      new ApiError({
        status: 402,
        code: "MAGIC_HOUR_INSUFFICIENT_CREDITS",
        message: "Not enough credits to start this job.",
        retryable: false,
      }),
    );
    render(<CreateFlow settings={settings} />);
    selectAndReady();

    const button = screen.getByRole("button", { name: "Transform" });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Not enough credits to start this job.");
    expect(button).toBeEnabled();
  });

  it("reuses the idempotency key when retrying the same failed submission", async () => {
    fetchMock
      .mockRejectedValueOnce(
        new ApiError({ status: 500, code: "INTERNAL", message: "x", retryable: true }),
      )
      .mockResolvedValueOnce({ job: job() });
    render(<CreateFlow settings={settings} />);
    selectAndReady();

    const button = screen.getByRole("button", { name: "Transform" });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstKey = (fetchMock.mock.calls[0]?.[1] as { body: { idempotencyKey: string } }).body
      .idempotencyKey;
    const secondKey = (fetchMock.mock.calls[1]?.[1] as { body: { idempotencyKey: string } }).body
      .idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it("clears the job card and resets the form when the source is replaced", () => {
    useJobPollingMock.mockReturnValue({
      jobs: [job({ status: "complete" })],
      refresh: vi.fn(),
      insertOptimistic: vi.fn(),
      error: false,
      stalled: false,
    });
    render(<CreateFlow settings={settings} />);
    selectAndReady();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Art style" })).toBeInTheDocument();

    act(() => captured.props?.onStateChange?.({ status: "idle" }));

    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Art style" })).not.toBeInTheDocument();
  });

  it("surfaces a stalled polling loop instead of a silently stale card", () => {
    useJobPollingMock.mockReturnValue({
      jobs: [],
      refresh: vi.fn(),
      insertOptimistic: vi.fn(),
      error: true,
      stalled: true,
    });
    render(<CreateFlow settings={settings} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/lost track of job updates/i);
  });

  it("retrying a failed job posts its stored source and params with a fresh idempotency key", async () => {
    const insertOptimistic = vi.fn();
    const failedJob = job({ status: "failed" });
    useJobPollingMock.mockReturnValue({
      jobs: [failedJob],
      refresh: vi.fn(),
      insertOptimistic,
      error: false,
      stalled: false,
    });
    const retryJob = job({ id: "job-2", retryOfJobId: "job-1" });
    fetchMock.mockResolvedValueOnce({ job: retryJob });

    render(<CreateFlow settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry anyway" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transform",
      expect.objectContaining({
        body: expect.objectContaining({
          sourceId: failedJob.sourceId,
          params: failedJob.params,
          retryOfJobId: failedJob.id,
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      }),
    );
    expect(insertOptimistic).toHaveBeenCalledWith(retryJob);
  });
});
