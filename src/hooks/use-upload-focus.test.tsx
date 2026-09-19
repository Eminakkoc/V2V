// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUploadFocus } from "./use-upload-focus";

function Harness({ status }: { status: string }) {
  const { progressLabelRef, dropZoneTitleRef, focusAfter } = useUploadFocus(status);
  return (
    <div>
      <p ref={progressLabelRef} tabIndex={-1}>
        Storing your video
      </p>
      <p ref={dropZoneTitleRef} tabIndex={-1}>
        Drop a video here
      </p>
      <button onClick={() => focusAfter("progress")}>retry</button>
      <button onClick={() => focusAfter("dropzone")}>replace</button>
    </div>
  );
}

describe("useUploadFocus", () => {
  it("focuses the progress label once storing starts after a requested retry", () => {
    const { rerender } = render(<Harness status="failed" />);
    fireEvent.click(screen.getByText("retry"));
    expect(document.activeElement).not.toBe(screen.getByText("Storing your video"));
    rerender(<Harness status="storing" />);
    expect(document.activeElement).toBe(screen.getByText("Storing your video"));
  });

  it("focuses the drop zone title once idle after a requested replace", () => {
    const { rerender } = render(<Harness status="ready" />);
    fireEvent.click(screen.getByText("replace"));
    rerender(<Harness status="idle" />);
    expect(document.activeElement).toBe(screen.getByText("Drop a video here"));
  });

  it("does not move focus on unrelated status changes", () => {
    const { rerender } = render(<Harness status="idle" />);
    rerender(<Harness status="uploading" />);
    rerender(<Harness status="storing" />);
    expect(document.activeElement).not.toBe(screen.getByText("Storing your video"));
  });

  it("clears the pending target once it fires, so a later matching status does not refocus", () => {
    const { rerender } = render(<Harness status="failed" />);
    fireEvent.click(screen.getByText("retry"));
    rerender(<Harness status="storing" />);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    rerender(<Harness status="failed" />);
    rerender(<Harness status="storing" />);
    expect(document.activeElement).not.toBe(screen.getByText("Storing your video"));
  });
});
