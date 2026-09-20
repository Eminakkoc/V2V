// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { HistoryJobView } from "@/lib/history-contract";
import { HistoryCard } from "./history-card";

function stubClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => {} },
    configurable: true,
  });
}

function buildJob(overrides: Partial<HistoryJobView> = {}): HistoryJobView {
  return {
    id: "job-1",
    sourceId: "source-1",
    status: "complete",
    phase: "rendering",
    params: {
      name: "My clip",
      startSeconds: 2,
      endSeconds: 14,
      fpsResolution: "HALF",
      artStyle: "Ghibli Anime",
      promptType: "default",
      model: "default",
      version: "default",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    deadlineAt: "2026-01-01T00:10:00.000Z",
    source: {
      cloudinaryPublicId: "sources/abc123",
      cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/v1/sources/abc123.mp4",
      duration: 20,
    },
    attempts: [],
    ...overrides,
  };
}

describe("HistoryCard", () => {
  beforeEach(() => {
    stubClipboard();
  });

  it("shows all three named deliverables: source URL, parameters, and generated URL", () => {
    const job = buildJob({
      output: {
        cloudinaryPublicId: "results/xyz789",
        cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/v1/results/xyz789.mp4",
      },
    });
    render(<HistoryCard job={job} cloudName="demo" />);

    expect(screen.getByRole("link", { name: job.source!.cloudinaryUrl })).toHaveAttribute(
      "href",
      job.source!.cloudinaryUrl,
    );
    expect(screen.getByRole("link", { name: job.output!.cloudinaryUrl })).toHaveAttribute(
      "href",
      job.output!.cloudinaryUrl,
    );
    expect(screen.getByText("Ghibli Anime")).toBeInTheDocument();
    expect(screen.getByText("0:12 clip")).toBeInTheDocument();
  });

  it("renders no result player, URL or copy control when the job has no output", () => {
    const job = buildJob({ output: undefined });
    const { container } = render(<HistoryCard job={job} cloudName="demo" />);

    expect(container.querySelector('video[aria-label^="Result:"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy result URL" })).not.toBeInTheDocument();
  });

  it("names each player with its visible label and the job name, as an accessible name", () => {
    const job = buildJob({
      output: {
        cloudinaryPublicId: "results/xyz789",
        cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/v1/results/xyz789.mp4",
      },
    });
    const { container } = render(<HistoryCard job={job} cloudName="demo" />);

    expect(container.querySelector('video[aria-label="Source: My clip"]')).toBeInTheDocument();
    expect(container.querySelector('video[aria-label="Result: My clip"]')).toBeInTheDocument();
  });

  it("announces a copy of the source URL politely rather than only visually", async () => {
    const job = buildJob({ output: undefined });
    const { container } = render(<HistoryCard job={job} cloudName="demo" />);
    // Scoped to the <p>: JobStatus's own aria-live="polite" <span> (the
    // status badge) is a second, unrelated live region on the same card.
    const region = container.querySelector('p[aria-live="polite"]');
    expect(region).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Copy source URL" }));

    await waitFor(() => expect(region).toHaveTextContent(/source url/i));
  });

  it("shows a 'Source unavailable' note and fabricates no Cloudinary URL when the source record is gone", () => {
    const job = buildJob({ source: null, sourceId: "deleted-source-id" });
    const { container } = render(<HistoryCard job={job} cloudName="demo" />);

    expect(screen.getByText("Source unavailable")).toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy source URL" })).not.toBeInTheDocument();
    // Guards specifically against a Cloudinary URL synthesised from sourceId
    // -- posterUrl/videoUrl would happily build one, and it would 404.
    for (const link of screen.queryAllByRole("link")) {
      expect(link.getAttribute("href")).not.toContain(job.sourceId);
    }
  });

  it("omits the Source column entirely for a nested attempt, even when source data is present", () => {
    const job = buildJob(); // has a real, non-null `source`
    const { container } = render(<HistoryCard job={job} cloudName="demo" variant="attempt" />);

    expect(screen.queryByText("Source unavailable")).not.toBeInTheDocument();
    expect(container.querySelector('video[aria-label^="Source:"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy source URL" })).not.toBeInTheDocument();
  });

  it("uses a lower heading level for a nested attempt than for a top-level card", () => {
    const job = buildJob();
    const { rerender } = render(<HistoryCard job={job} cloudName="demo" variant="top" />);
    expect(screen.getByRole("heading", { level: 2, name: job.params.name })).toBeInTheDocument();

    rerender(<HistoryCard job={job} cloudName="demo" variant="attempt" />);
    expect(screen.getByRole("heading", { level: 3, name: job.params.name })).toBeInTheDocument();
  });

  it("shows the job's created time as a machine-readable <time>, on both variants", () => {
    const job = buildJob({ createdAt: "2026-01-01T00:05:00.000Z" });

    const top = render(<HistoryCard job={job} cloudName="demo" variant="top" />);
    const topTime = top.container.querySelector('time[datetime="2026-01-01T00:05:00.000Z"]');
    expect(topTime).toBeInTheDocument();
    expect(topTime).toHaveTextContent("Jan 1, 2026");

    const attempt = render(<HistoryCard job={job} cloudName="demo" variant="attempt" />);
    expect(
      attempt.container.querySelector('time[datetime="2026-01-01T00:05:00.000Z"]'),
    ).toBeInTheDocument();
  });

  it("shows the job's completed time only once it has actually completed", () => {
    const notYet = buildJob({ completedAt: undefined });
    const notYetRendered = render(<HistoryCard job={notYet} cloudName="demo" />);
    expect(notYetRendered.getByText("Created", { exact: false })).toBeInTheDocument();
    expect(notYetRendered.queryByText("Completed", { exact: false })).not.toBeInTheDocument();

    const done = buildJob({ completedAt: "2026-01-01T00:12:00.000Z" });
    const doneRendered = render(<HistoryCard job={done} cloudName="demo" />);
    const completedTime = doneRendered.container.querySelector(
      'time[datetime="2026-01-01T00:12:00.000Z"]',
    );
    expect(completedTime).toBeInTheDocument();
    expect(completedTime).toHaveTextContent("Jan 1, 2026");
  });

  it("renders the result player for a nested attempt that completed with output", () => {
    const job = buildJob({
      status: "complete",
      output: {
        cloudinaryPublicId: "results/xyz789",
        cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/v1/results/xyz789.mp4",
      },
    });
    const { container } = render(<HistoryCard job={job} cloudName="demo" variant="attempt" />);

    expect(container.querySelector('video[aria-label^="Result:"]')).toBeInTheDocument();
  });

  it("renders no result player for a nested attempt that has not produced output", () => {
    const job = buildJob({ status: "processing", output: undefined });
    const { container } = render(<HistoryCard job={job} cloudName="demo" variant="attempt" />);

    expect(container.querySelector('video[aria-label^="Result:"]')).not.toBeInTheDocument();
  });
});
