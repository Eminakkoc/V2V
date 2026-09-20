// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AttemptView } from "@/lib/history-contract";
import { PreviousAttempts } from "./previous-attempts";

let autoId = 0;

type AttemptOverrides = Partial<Omit<AttemptView, "params">> & {
  params?: Partial<AttemptView["params"]>;
};

function buildAttempt(overrides: AttemptOverrides = {}): AttemptView {
  autoId += 1;
  const base: AttemptView = {
    id: `attempt-${autoId}`,
    sourceId: "source-1",
    status: "failed",
    phase: "rendering",
    params: {
      name: `Attempt ${autoId}`,
      startSeconds: 0,
      endSeconds: 5,
      fpsResolution: "HALF",
      artStyle: "Anime Warrior",
      promptType: "default",
      model: "default",
      version: "default",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    deadlineAt: "2026-01-01T00:10:00.000Z",
  };
  return {
    ...base,
    ...overrides,
    params: { ...base.params, ...overrides.params },
  };
}

function stubClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => {} },
    configurable: true,
  });
}
stubClipboard();

describe("PreviousAttempts", () => {
  it("renders nothing when there are no earlier attempts", () => {
    const { container } = render(<PreviousAttempts attempts={[]} cloudName="demo" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts every attempt in the header but marks none finished when all are still changeable", () => {
    const attempts = [
      buildAttempt({ status: "processing" }),
      buildAttempt({ status: "superseded" }),
    ];
    render(<PreviousAttempts attempts={attempts} cloudName="demo" />);

    expect(screen.getByRole("button", { name: "Previous attempts (2)" })).toBeInTheDocument();
  });

  it("does not count a merely superseded attempt as finished", () => {
    // Every previous attempt is superseded by definition -- if this counted,
    // the header would always read "(1) -- 1 finished" for a single-attempt
    // chain, which is the exact confusion F11 calls out.
    const attempts = [buildAttempt({ status: "superseded" })];
    render(<PreviousAttempts attempts={attempts} cloudName="demo" />);

    expect(screen.getByRole("button", { name: "Previous attempts (1)" })).toBeInTheDocument();
    expect(screen.queryByText(/finished/)).not.toBeInTheDocument();
  });

  it.each([["complete"], ["failed"], ["timed_out"], ["abandoned"]] as const)(
    "counts a %s attempt as finished",
    (status) => {
      const attempts = [buildAttempt({ status })];
      render(<PreviousAttempts attempts={attempts} cloudName="demo" />);

      expect(
        screen.getByRole("button", { name: "Previous attempts (1) — 1 finished" }),
      ).toBeInTheDocument();
    },
  );

  it("does not count a queued or rendering attempt as finished", () => {
    const attempts = [
      buildAttempt({ status: "processing", phase: "queued" }),
      buildAttempt({ status: "processing", phase: "rendering" }),
      buildAttempt({ status: "finalizing" }),
    ];
    render(<PreviousAttempts attempts={attempts} cloudName="demo" />);

    expect(screen.getByRole("button", { name: "Previous attempts (3)" })).toBeInTheDocument();
  });

  it("follows a re-checked attempt's status across refreshes -- timed_out counts, then complete still counts", () => {
    const attempt = buildAttempt({ status: "timed_out" });
    const { rerender } = render(<PreviousAttempts attempts={[attempt]} cloudName="demo" />);
    expect(
      screen.getByRole("button", { name: "Previous attempts (1) — 1 finished" }),
    ).toBeInTheDocument();

    rerender(<PreviousAttempts attempts={[{ ...attempt, status: "complete" }]} cloudName="demo" />);
    expect(
      screen.getByRole("button", { name: "Previous attempts (1) — 1 finished" }),
    ).toBeInTheDocument();
  });

  it("shows the earlier-attempt-finished callout even while collapsed, and omits it when none finished", () => {
    const { rerender } = render(
      <PreviousAttempts attempts={[buildAttempt({ status: "complete" })]} cloudName="demo" />,
    );
    expect(screen.getByText("An earlier attempt finished — view result")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous attempts/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    rerender(
      <PreviousAttempts attempts={[buildAttempt({ status: "processing" })]} cloudName="demo" />,
    );
    expect(screen.queryByText(/earlier attempt finished/)).not.toBeInTheDocument();
  });

  it("is collapsed by default and reveals the attempts list on toggle", () => {
    const attempts = [buildAttempt({ params: { name: "Only attempt" } })];
    render(<PreviousAttempts attempts={attempts} cloudName="demo" />);

    const trigger = screen.getByRole("button", { name: /Previous attempts/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Only attempt" })).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { level: 3, name: "Only attempt" })).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Only attempt" })).not.toBeInTheDocument();
  });

  it("lists attempts oldest-to-newest regardless of input order", () => {
    const older = buildAttempt({
      createdAt: "2026-01-01T00:00:00.000Z",
      params: { name: "Older attempt" },
    });
    const newer = buildAttempt({
      createdAt: "2026-01-02T00:00:00.000Z",
      params: { name: "Newer attempt" },
    });
    render(<PreviousAttempts attempts={[newer, older]} cloudName="demo" />);
    fireEvent.click(screen.getByRole("button", { name: /Previous attempts/ }));

    const headings = screen.getAllByRole("heading", { level: 3 }).map((el) => el.textContent);
    expect(headings).toEqual(["Older attempt", "Newer attempt"]);
  });
});
