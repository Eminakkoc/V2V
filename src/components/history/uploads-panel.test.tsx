// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceView } from "@/lib/history-contract";
import { UploadsPanel } from "./uploads-panel";

let autoId = 0;

function buildSource(overrides: Partial<SourceView> = {}): SourceView {
  autoId += 1;
  return {
    id: `source-${autoId}`,
    cloudinaryPublicId: `sources/${autoId}`,
    cloudinaryUrl: `https://res.cloudinary.com/demo/video/upload/v1/sources/${autoId}.mp4`,
    format: "video/mp4",
    duration: 10,
    width: 1080,
    height: 1920,
    bytes: 1_000_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    transformCount: 0,
    ...overrides,
  };
}

describe("UploadsPanel", () => {
  it("shows the browser-scoped note whether the list is empty or not", () => {
    const { rerender } = render(<UploadsPanel sources={[]} cloudName="demo" hasMore={false} />);
    expect(screen.getByText("History is tied to this browser.")).toBeInTheDocument();

    rerender(<UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={false} />);
    expect(screen.getByText("History is tied to this browser.")).toBeInTheDocument();
  });

  it("shows the No uploads yet state, and no source cards, when there are no sources", () => {
    render(<UploadsPanel sources={[]} cloudName="demo" hasMore={false} />);

    expect(screen.getByRole("heading", { name: "No uploads yet" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("lists a SourceCard per source once any exist, in place of the empty state", () => {
    const sources = [buildSource(), buildSource()];
    render(<UploadsPanel sources={sources} cloudName="demo" hasMore={false} />);

    expect(screen.queryByRole("heading", { name: "No uploads yet" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("dissolves the empty state, with no reload, once a merge inserts the first source", () => {
    const { rerender } = render(<UploadsPanel sources={[]} cloudName="demo" hasMore={false} />);
    expect(screen.getByRole("heading", { name: "No uploads yet" })).toBeInTheDocument();

    rerender(<UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={false} />);

    expect(screen.queryByRole("heading", { name: "No uploads yet" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("offers Load more only once more pages remain", () => {
    const { rerender } = render(
      <UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={true} />,
    );
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();

    rerender(<UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={false} />);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("the last-page state adds no copy of its own -- only the button disappears", () => {
    const { container: withMore } = render(
      <UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={true} />,
    );
    const { container: withoutMore } = render(
      <UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={false} />,
    );

    const textWithout = (node: HTMLElement) =>
      Array.from(node.querySelectorAll("h2, p")).map((el) => el.textContent);
    // Same headings/paragraphs either way, aside from the list items
    // themselves not being compared here -- only the affordance differs.
    expect(textWithout(withoutMore)).toEqual(textWithout(withMore));
    expect(withMore.querySelector("button")).not.toBeNull();
    expect(withoutMore.querySelector("button")).toBeNull();
  });

  it("clicking Load more calls the callback exactly once", () => {
    const onLoadMore = vi.fn();
    render(
      <UploadsPanel
        sources={[buildSource()]}
        cloudName="demo"
        hasMore={true}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("shows exactly one Load more button, even as more sources load in", () => {
    const { rerender } = render(
      <UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={true} />,
    );
    expect(screen.getAllByRole("button", { name: /load more/i })).toHaveLength(1);

    // Simulates a completed load-more cycle appending rows -- the button
    // must stay singular rather than one appearing per row (which is what
    // it would render as if it lived inside the sources.map() instead of
    // after it).
    rerender(
      <UploadsPanel
        sources={[buildSource(), buildSource(), buildSource()]}
        cloudName="demo"
        hasMore={true}
      />,
    );
    expect(screen.getAllByRole("button", { name: /load more/i })).toHaveLength(1);
  });

  it("disables Load more while a page is already loading", () => {
    render(<UploadsPanel sources={[buildSource()]} cloudName="demo" hasMore={true} loadingMore />);

    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("shows the no-match state instead of No uploads yet once a filter is active", () => {
    render(<UploadsPanel sources={[]} cloudName="demo" hasMore={false} hasActiveFilter />);

    expect(screen.getByRole("heading", { name: "No matches" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No uploads yet" })).not.toBeInTheDocument();
  });
});
