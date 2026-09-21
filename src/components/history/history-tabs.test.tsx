// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryTabs } from "./history-tabs";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("HistoryTabs", () => {
  it("exposes the APG tablist/tab/tabpanel roles, with the active tab selected and the panel labelled by it", () => {
    render(
      <HistoryTabs active="jobs">
        <p>Transformations content</p>
      </HistoryTabs>,
    );

    expect(screen.getByRole("tablist", { name: "History views" })).toBeInTheDocument();
    const jobsTab = screen.getByRole("tab", { name: "Transformations" });
    const sourcesTab = screen.getByRole("tab", { name: "Uploaded videos" });
    expect(jobsTab).toHaveAttribute("aria-selected", "true");
    expect(sourcesTab).toHaveAttribute("aria-selected", "false");

    const panel = screen.getByRole("tabpanel", { name: "Transformations" });
    expect(panel).toHaveTextContent("Transformations content");
    expect(panel).toHaveAttribute("aria-labelledby", jobsTab.id);
  });

  it("moves roving focus to the next tab on ArrowRight without navigating", async () => {
    render(
      <HistoryTabs active="jobs">
        <p>content</p>
      </HistoryTabs>,
    );
    const jobsTab = screen.getByRole("tab", { name: "Transformations" });
    const sourcesTab = screen.getByRole("tab", { name: "Uploaded videos" });

    jobsTab.focus();
    expect(document.activeElement).toBe(jobsTab);

    fireEvent.keyDown(jobsTab, { key: "ArrowRight" });

    // Radix's roving focus group moves focus from a setTimeout(0) queued by the keydown handler,
    // not synchronously with the keypress.
    await waitFor(() => expect(document.activeElement).toBe(sourcesTab));
    expect(router.push).not.toHaveBeenCalled();
    expect(jobsTab).toHaveAttribute("aria-selected", "true");
  });

  it("moves roving focus back around from the last tab to the first on ArrowRight (loop)", async () => {
    render(
      <HistoryTabs active="jobs">
        <p>content</p>
      </HistoryTabs>,
    );
    const jobsTab = screen.getByRole("tab", { name: "Transformations" });
    const sourcesTab = screen.getByRole("tab", { name: "Uploaded videos" });

    sourcesTab.focus();
    fireEvent.keyDown(sourcesTab, { key: "ArrowRight" });

    await waitFor(() => expect(document.activeElement).toBe(jobsTab));
  });

  it("activates the focused tab on Enter, navigating to that tab's URL", async () => {
    render(
      <HistoryTabs active="jobs">
        <p>content</p>
      </HistoryTabs>,
    );
    const jobsTab = screen.getByRole("tab", { name: "Transformations" });
    const sourcesTab = screen.getByRole("tab", { name: "Uploaded videos" });
    jobsTab.focus();
    fireEvent.keyDown(jobsTab, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(sourcesTab));

    expect(router.push).not.toHaveBeenCalled();
    fireEvent.keyDown(sourcesTab, { key: "Enter" });

    expect(router.push).toHaveBeenCalledWith("/history?tab=sources");
  });

  it("clicking the inactive tab navigates to its bare /history URL, and clicking Uploaded videos adds ?tab=sources", () => {
    render(
      <HistoryTabs active="jobs">
        <p>content</p>
      </HistoryTabs>,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Uploaded videos" }));
    expect(router.push).toHaveBeenCalledWith("/history?tab=sources");
  });

  it("clicking back to Transformations navigates to /history with no tab param", () => {
    render(
      <HistoryTabs active="sources">
        <p>content</p>
      </HistoryTabs>,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Transformations" }));
    expect(router.push).toHaveBeenCalledWith("/history");
  });
});
