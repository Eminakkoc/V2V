// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilterBar, type FilterBarProps } from "./filter-bar";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const searchParamsValue = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParamsValue.current,
}));

function defaultProps(overrides: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    sort: "createdAt",
    dir: "desc",
    includePrevious: false,
    isListEmpty: false,
    ...overrides,
  };
}

beforeEach(() => {
  searchParamsValue.current = new URLSearchParams();
});

describe("FilterBar", () => {
  it("changing the status control pushes the resolved URL rather than fetching", () => {
    render(<FilterBar {...defaultProps()} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("option", { name: "Complete" }));

    expect(router.push).toHaveBeenCalledWith("/history?statusBucket=complete");
  });

  it("clearing a filter back to All removes it from the URL instead of sending an explicit 'all'", () => {
    searchParamsValue.current = new URLSearchParams("statusBucket=failed");
    render(<FilterBar {...defaultProps({ statusBucket: "failed" })} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Status: Failed" }));
    fireEvent.click(screen.getByRole("option", { name: "All" }));

    expect(router.push).toHaveBeenCalledWith("/history");
  });

  it("changing style pushes the style query param", () => {
    render(<FilterBar {...defaultProps()} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Style: All styles" }));
    fireEvent.click(screen.getByRole("option", { name: "Watercolor" }));

    expect(router.push).toHaveBeenCalledWith("/history?style=Watercolor");
  });

  it("changing sort pushes both the sort key and its direction together", () => {
    render(<FilterBar {...defaultProps()} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Sort: Newest first" }));
    fireEvent.click(screen.getByRole("option", { name: "Longest clip first" }));

    expect(router.push).toHaveBeenCalledWith("/history?sort=duration&dir=desc");
  });

  it("toggling include-previous on sends includePrevious=true, and off removes it", () => {
    const { rerender } = render(<FilterBar {...defaultProps({ includePrevious: false })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include previous attempts" }));
    expect(router.push).toHaveBeenLastCalledWith("/history?includePrevious=true");

    searchParamsValue.current = new URLSearchParams("includePrevious=true");
    rerender(<FilterBar {...defaultProps({ includePrevious: true })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include previous attempts" }));
    expect(router.push).toHaveBeenLastCalledWith("/history");
  });

  it("a filter change drops any existing page cursor, since the old page no longer follows from the new query", () => {
    searchParamsValue.current = new URLSearchParams("cursor=abc123");
    render(<FilterBar {...defaultProps()} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Status: All" }));
    fireEvent.click(screen.getByRole("option", { name: "Complete" }));

    expect(router.push).toHaveBeenCalledWith("/history?statusBucket=complete");
  });

  it("hides the sort control while the list is empty, on both layouts", () => {
    render(<FilterBar {...defaultProps({ isListEmpty: true })} />);
    expect(screen.queryByRole("combobox", { name: /^Sort:/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("combobox", { name: /^Sort:/ })).not.toBeInTheDocument();
  });

  it("shows the sort control once the list is non-empty", () => {
    render(<FilterBar {...defaultProps({ isListEmpty: false })} />);
    expect(screen.getByRole("combobox", { name: "Sort: Newest first" })).toBeInTheDocument();
  });

  describe("the phone filter sheet", () => {
    it("opens as a modal dialog with the status and style controls exposed as radiogroups of chips", () => {
      render(<FilterBar {...defaultProps({ statusBucket: "complete" })} />);
      fireEvent.click(screen.getByRole("button", { name: "Filter" }));

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");

      const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
      const checked = within(statusGroup).getByRole("radio", { checked: true });
      expect(checked).toHaveTextContent("Complete");
      expect(within(statusGroup).getByRole("radio", { name: "All" })).toHaveAttribute(
        "aria-checked",
        "false",
      );

      const styleGroup = within(dialog).getByRole("radiogroup", { name: "Style" });
      expect(within(styleGroup).getByRole("radio", { name: "Watercolor" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("selecting a status chip inside the sheet pushes the same URL the desktop control would", () => {
      render(<FilterBar {...defaultProps()} />);
      fireEvent.click(screen.getByRole("button", { name: "Filter" }));
      const dialog = screen.getByRole("dialog");

      fireEvent.click(within(dialog).getByRole("radio", { name: "Taking longer" }));

      expect(router.push).toHaveBeenCalledWith("/history?statusBucket=taking-longer");
    });

    it("traps focus inside the sheet while it is open", () => {
      render(<FilterBar {...defaultProps()} />);
      fireEvent.click(screen.getByRole("button", { name: "Filter" }));

      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("returns focus to the Filter button once the sheet is closed with its close button", async () => {
      render(<FilterBar {...defaultProps()} />);
      const filterButton = screen.getByRole("button", { name: "Filter" });
      fireEvent.click(filterButton);

      fireEvent.click(screen.getByRole("button", { name: "Close filters" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      // Radix restores focus from a setTimeout(0) queued when the dialog
      // unmounts, not synchronously with the click -- waitFor lets that
      // macrotask run rather than asserting before it has a chance to.
      await waitFor(() => expect(document.activeElement).toBe(filterButton));
    });

    it("returns focus to the Filter button once the sheet is closed with Escape", async () => {
      render(<FilterBar {...defaultProps()} />);
      const filterButton = screen.getByRole("button", { name: "Filter" });
      fireEvent.click(filterButton);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(document.activeElement).toBe(filterButton));
    });

    it("the drag handle is decorative and not exposed to assistive tech", () => {
      render(<FilterBar {...defaultProps()} />);
      fireEvent.click(screen.getByRole("button", { name: "Filter" }));

      // The sheet portals into document.body, outside the render container.
      const handle = screen.getByRole("dialog").querySelector('[aria-hidden="true"].bg-muted');
      expect(handle).toBeInTheDocument();
    });
  });
});
