// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useJobPolling } from "@/components/job/job-polling-provider";
import type { HistoryJobView } from "@/lib/history-contract";
import { CreateFlow, type CreateFlowSettings } from "./create-flow";

// Deliberately does NOT mock SourceUploader: the bug this guards against lives in the wiring
// between the real uploader mount and CreateFlow's reducer.
vi.mock("@uploadcare/react-uploader/next", () => ({ FileUploaderRegular: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/job/job-polling-provider", () => ({ useJobPolling: vi.fn() }));

const useJobPollingMock = vi.mocked(useJobPolling);

const settings: CreateFlowSettings = {
  publicKey: "demo-key",
  allowedFormats: ["video/mp4"],
  maxBytes: 100_000_000,
  maxClipSeconds: 30,
  cloudName: "demo",
};

function job(overrides: Partial<HistoryJobView> = {}): HistoryJobView {
  return {
    id: "job-1",
    sourceId: "source-1",
    status: "complete",
    phase: "rendering",
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
    source: {
      cloudinaryPublicId: "sources/a",
      cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/sources/a.mp4",
      duration: 10,
    },
    attempts: [],
    ...overrides,
  };
}

describe("CreateFlow mount, against the real SourceUploader", () => {
  it("still shows a job already on the account on first render, before any upload", async () => {
    useJobPollingMock.mockReturnValue({
      jobs: [job()],
      refresh: vi.fn(),
      insertOptimistic: vi.fn(),
      trackChangeable: vi.fn(),
      error: false,
      stalled: false,
    });

    render(<CreateFlow settings={settings} />);

    // The real uploader mounts as "idle", and anything reporting that mount as a state change would
    // make CreateFlow read it as a reset and hide this job.
    expect(
      await screen.findByText("Complete", { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument();
  });
});
