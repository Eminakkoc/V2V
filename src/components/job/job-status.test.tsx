// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JobStatus } from "./job-status";

describe("JobStatus", () => {
  it("renders the label for the current status", () => {
    render(<JobStatus job={{ status: "processing", phase: "rendering" }} />);
    expect(screen.getByText("Rendering")).toBeInTheDocument();
  });

  it("announces a status change to assistive tech via a polite live region", () => {
    const { rerender, container } = render(
      <JobStatus job={{ status: "processing", phase: "queued" }} />,
    );
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent("Queued");

    rerender(<JobStatus job={{ status: "processing", phase: "rendering" }} />);
    expect(region).toHaveTextContent("Rendering");
  });

  it("renders nothing for a superseded job, since it is only shown in Previous attempts", () => {
    const { container } = render(<JobStatus job={{ status: "superseded", phase: "rendering" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
