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

  // IR-008: disabled rather than unmounted. Unmounting it removed a control
  // from the filter row the moment a filter matched nothing, which shifted
  // everything beside it, and left no way to re-sort from an empty result
  // without first clearing the filter.
  it("disables the sort control while the list is empty, on both layouts, without removing it", () => {
    render(<FilterBar {...defaultProps({ isListEmpty: true })} />);
    expect(screen.getByRole("combobox", { name: /^Sort:/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /^Sort:/ })).toBeDisabled();
  });

  it("enables the sort control once the list is non-empty", () => {
    render(<FilterBar {...defaultProps({ isListEmpty: false })} />);
    expect(screen.getByRole("combobox", { name: "Sort: Newest first" })).toBeEnabled();
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

    describe("the radiogroup chips' keyboard model", () => {
      function openDialog(props: Partial<FilterBarProps> = {}) {
        render(<FilterBar {...defaultProps(props)} />);
        fireEvent.click(screen.getByRole("button", { name: "Filter" }));
        return screen.getByRole("dialog");
      }

      it("puts only the checked chip in the tab order; every other chip is tabIndex -1", () => {
        const dialog = openDialog({ statusBucket: "complete" });
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        const radios = within(statusGroup).getAllByRole("radio");

        const tabbable = radios.filter((radio) => radio.getAttribute("tabindex") === "0");
        expect(tabbable).toHaveLength(1);
        expect(tabbable[0]).toHaveTextContent("Complete");
        for (const radio of radios) {
          if (radio !== tabbable[0]) expect(radio).toHaveAttribute("tabindex", "-1");
        }
      });

      it("makes the first chip (All) the tab stop when nothing is checked yet", () => {
        const dialog = openDialog();
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        expect(within(statusGroup).getByRole("radio", { name: "All" })).toHaveAttribute(
          "tabindex",
          "0",
        );
        for (const radio of within(statusGroup)
          .getAllByRole("radio")
          .filter((radio) => radio.textContent !== "All")) {
          expect(radio).toHaveAttribute("tabindex", "-1");
        }
      });

      it("ArrowRight moves focus to the next chip and selects it -- the same navigation a click triggers", () => {
        const dialog = openDialog();
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        const all = within(statusGroup).getByRole("radio", { name: "All" });
        const inProgress = within(statusGroup).getByRole("radio", { name: "In progress" });

        all.focus();
        fireEvent.keyDown(all, { key: "ArrowRight" });

        expect(document.activeElement).toBe(inProgress);
        expect(router.push).toHaveBeenCalledWith("/history?statusBucket=in-progress");
      });

      it("ArrowLeft moves focus to the previous chip and selects it", () => {
        const dialog = openDialog({ statusBucket: "in-progress" });
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        const inProgress = within(statusGroup).getByRole("radio", { name: "In progress" });
        const all = within(statusGroup).getByRole("radio", { name: "All" });

        inProgress.focus();
        fireEvent.keyDown(inProgress, { key: "ArrowLeft" });

        expect(document.activeElement).toBe(all);
        expect(router.push).toHaveBeenCalledWith("/history");
      });

      it("wraps ArrowRight from the last chip to the first, and ArrowLeft from the first to the last", () => {
        const dialog = openDialog();
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        const all = within(statusGroup).getByRole("radio", { name: "All" });
        const failed = within(statusGroup).getByRole("radio", { name: "Failed" });

        failed.focus();
        fireEvent.keyDown(failed, { key: "ArrowRight" });
        expect(document.activeElement).toBe(all);
        expect(router.push).toHaveBeenLastCalledWith("/history");

        all.focus();
        fireEvent.keyDown(all, { key: "ArrowLeft" });
        expect(document.activeElement).toBe(failed);
        expect(router.push).toHaveBeenLastCalledWith("/history?statusBucket=failed");
      });

      it("Home and End jump to the first and last chip and select it", () => {
        const dialog = openDialog();
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        const all = within(statusGroup).getByRole("radio", { name: "All" });
        const failed = within(statusGroup).getByRole("radio", { name: "Failed" });

        all.focus();
        fireEvent.keyDown(all, { key: "End" });
        expect(document.activeElement).toBe(failed);
        expect(router.push).toHaveBeenLastCalledWith("/history?statusBucket=failed");

        fireEvent.keyDown(failed, { key: "Home" });
        expect(document.activeElement).toBe(all);
        expect(router.push).toHaveBeenLastCalledWith("/history");
      });

      it("Space and Enter (re)select the focused chip", () => {
        const dialog = openDialog();
        const statusGroup = within(dialog).getByRole("radiogroup", { name: "Status" });
        const complete = within(statusGroup).getByRole("radio", { name: "Complete" });

        complete.focus();
        fireEvent.keyDown(complete, { key: " " });
        expect(router.push).toHaveBeenLastCalledWith("/history?statusBucket=complete");

        fireEvent.keyDown(complete, { key: "Enter" });
        expect(router.push).toHaveBeenLastCalledWith("/history?statusBucket=complete");
      });

      it("applies the same keyboard model to the Style radiogroup", () => {
        const dialog = openDialog();
        const styleGroup = within(dialog).getByRole("radiogroup", { name: "Style" });
        const allStyles = within(styleGroup).getByRole("radio", { name: "All styles" });
        const firstStyle = within(styleGroup).getByRole("radio", { name: "3D Render" });

        allStyles.focus();
        fireEvent.keyDown(allStyles, { key: "ArrowRight" });

        expect(document.activeElement).toBe(firstStyle);
        expect(router.push).toHaveBeenCalledWith("/history?style=3D+Render");
      });
    });

    it("starts with focus inside the sheet once it opens", () => {
      render(<FilterBar {...defaultProps()} />);
      fireEvent.click(screen.getByRole("button", { name: "Filter" }));

      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("traps focus inside the sheet -- moving focus outside it is pulled straight back in", () => {
      // jsdom has no native Tab-key focus traversal to hijack, so this
      // exercises Radix FocusScope's real trap mechanism directly: it
      // watches `focusin` on the document and, whenever the new target
      // isn't inside the trapped container, refocuses back inside. A
      // literal Tab keydown would not move focus anywhere under jsdom in
      // the first place, so it could never show escape being prevented --
      // this does the one thing that actually would move focus out.
      const outside = document.createElement("button");
      outside.textContent = "Outside the sheet";
      document.body.appendChild(outside);

      try {
        render(<FilterBar {...defaultProps()} />);
        fireEvent.click(screen.getByRole("button", { name: "Filter" }));
        const dialog = screen.getByRole("dialog");
        expect(dialog.contains(document.activeElement)).toBe(true);

        outside.focus();

        expect(document.activeElement).not.toBe(outside);
        expect(dialog.contains(document.activeElement)).toBe(true);
      } finally {
        outside.remove();
      }
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
