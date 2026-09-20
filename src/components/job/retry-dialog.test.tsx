// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobView } from "@/lib/transform-contract";
import { RetryDialog } from "./retry-dialog";

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    sourceId: "source-1",
    status: "failed",
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
    ...overrides,
  };
}

describe("RetryDialog", () => {
  it.each(["failed", "timed_out", "abandoned"] as const)("offers retry on a %s job", (status) => {
    render(<RetryDialog job={job({ status })} onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it.each(["processing", "finalizing"] as const)("does not offer retry on a %s job", (status) => {
    const { container } = render(<RetryDialog job={job({ status })} onConfirm={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns that retrying costs credits again", () => {
    render(<RetryDialog job={job()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/charges credits again/i);
  });

  it("confirming calls back with the job and does not touch the network itself", () => {
    const onConfirm = vi.fn();
    const theJob = job();
    render(<RetryDialog job={theJob} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry anyway" }));
    expect(onConfirm).toHaveBeenCalledWith(theJob);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancelling calls back nothing", () => {
    const onConfirm = vi.fn();
    render(<RetryDialog job={job()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("traps focus inside the dialog once opened", () => {
    render(<RetryDialog job={job()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("is dismissible with Escape", () => {
    render(<RetryDialog job={job()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("disables the trigger while a submission is in flight", () => {
    render(<RetryDialog job={job()} onConfirm={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
  });
});
