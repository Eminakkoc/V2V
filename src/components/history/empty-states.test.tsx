// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BrowserScopedNote,
  HistoryEmptyState,
  NoMatches,
  NoTransformationsYet,
  NoUploadsYet,
} from "./empty-states";

describe("BrowserScopedNote", () => {
  it("names the browser-scoping limitation, unconditionally", () => {
    render(<BrowserScopedNote />);
    expect(screen.getByText("History is tied to this browser.")).toBeInTheDocument();
  });
});

describe("NoUploadsYet", () => {
  it("names the empty state and links its call to action to the upload entry point", () => {
    render(<NoUploadsYet uploadHref="/" />);

    expect(screen.getByRole("heading", { name: "No uploads yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload your first video" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("NoTransformationsYet", () => {
  it("offers the upload entry point when the reader has no uploads yet", () => {
    render(
      <NoTransformationsYet
        hasUploads={false}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
      />,
    );

    expect(screen.getByRole("heading", { name: "No transformations yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload your first video" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByRole("link", { name: "Transform an upload" })).not.toBeInTheDocument();
  });

  it("switches to the Uploaded videos tab instead, once the reader already has uploads (F15)", () => {
    render(
      <NoTransformationsYet
        hasUploads={true}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
      />,
    );

    expect(screen.getByRole("link", { name: "Transform an upload" })).toHaveAttribute(
      "href",
      "/history?tab=sources",
    );
    expect(screen.queryByRole("link", { name: "Upload your first video" })).not.toBeInTheDocument();
  });
});

describe("NoMatches", () => {
  it("names each tab's own copy and offers to clear filters", () => {
    const { rerender } = render(
      <NoMatches tab="uploads" clearFiltersHref="/history?tab=sources" />,
    );
    expect(screen.getByText("No uploads match your filters.")).toBeInTheDocument();

    rerender(<NoMatches tab="transformations" clearFiltersHref="/history" />);
    expect(screen.getByText("No transformations match your filters.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/history");
  });
});

describe("HistoryEmptyState", () => {
  it("renders nothing once the list on screen has rows", () => {
    const { container } = render(
      <HistoryEmptyState
        tab="uploads"
        rows={[{ id: "a" }]}
        hasActiveFilter={false}
        uploadHref="/"
        clearFiltersHref="/history?tab=sources"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the Uploads tab's own nothing-yet state, never the Transformations one", () => {
    render(
      <HistoryEmptyState
        tab="uploads"
        rows={[]}
        hasActiveFilter={false}
        uploadHref="/"
        clearFiltersHref="/history?tab=sources"
      />,
    );
    expect(screen.getByRole("heading", { name: "No uploads yet" })).toBeInTheDocument();
    expect(screen.queryByText(/No transformations/)).not.toBeInTheDocument();
  });

  it("shows only the Transformations tab's own nothing-yet state, never the Uploads one", () => {
    render(
      <HistoryEmptyState
        tab="transformations"
        rows={[]}
        hasActiveFilter={false}
        hasUploads={false}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
        clearFiltersHref="/history"
      />,
    );
    expect(screen.getByRole("heading", { name: "No transformations yet" })).toBeInTheDocument();
    expect(screen.queryByText(/No uploads yet/)).not.toBeInTheDocument();
  });

  it("lets a no-match state override the Transformations tab's nothing-yet copy while a filter is active", () => {
    render(
      <HistoryEmptyState
        tab="transformations"
        rows={[]}
        hasActiveFilter={true}
        hasUploads={true}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
        clearFiltersHref="/history?statusBucket=complete"
      />,
    );
    expect(screen.getByRole("heading", { name: "No matches" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No transformations yet" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/history?statusBucket=complete",
    );
  });

  it("lets a no-match state override the Uploads tab's nothing-yet copy while a filter is active", () => {
    render(
      <HistoryEmptyState
        tab="uploads"
        rows={[]}
        hasActiveFilter={true}
        uploadHref="/"
        clearFiltersHref="/history?tab=sources"
      />,
    );
    expect(screen.getByRole("heading", { name: "No matches" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No uploads yet" })).not.toBeInTheDocument();
  });

  it("dissolves the no-match state, with no reload, the instant a merge inserts a matching row", () => {
    const { rerender, container } = render(
      <HistoryEmptyState
        tab="uploads"
        rows={[]}
        hasActiveFilter={true}
        uploadHref="/"
        clearFiltersHref="/history?tab=sources"
      />,
    );
    expect(screen.getByRole("heading", { name: "No matches" })).toBeInTheDocument();

    // Simulates a live refresh merging in a row that now matches -- the
    // caller passes the same, larger `rows` array on its next render; no
    // remount, no server round trip.
    rerender(
      <HistoryEmptyState
        tab="uploads"
        rows={[{ id: "newly-merged" }]}
        hasActiveFilter={true}
        uploadHref="/"
        clearFiltersHref="/history?tab=sources"
      />,
    );

    expect(screen.queryByRole("heading", { name: "No matches" })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("dissolves a nothing-yet state the same way once the first row ever arrives", () => {
    const { rerender, container } = render(
      <HistoryEmptyState
        tab="transformations"
        rows={[]}
        hasActiveFilter={false}
        hasUploads={false}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
        clearFiltersHref="/history"
      />,
    );
    expect(screen.getByRole("heading", { name: "No transformations yet" })).toBeInTheDocument();

    rerender(
      <HistoryEmptyState
        tab="transformations"
        rows={[{ id: "first-job" }]}
        hasActiveFilter={false}
        hasUploads={false}
        uploadHref="/"
        switchToUploadsHref="/history?tab=sources"
        clearFiltersHref="/history"
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "No transformations yet" }),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
