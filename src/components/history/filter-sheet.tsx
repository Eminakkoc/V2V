"use client";

import { Check, XIcon } from "lucide-react";
import { useId, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BUCKET_LABELS, STATUS_BUCKETS, type StatusBucket } from "@/lib/history-filters";
import { ART_STYLES, type ArtStyle } from "@/lib/magic-hour-styles";
import { cn } from "@/lib/utils";

export type SortOption = {
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  label: string;
};

// One control for both sort key and direction (W11): four combined options
// rather than two selects, so there is only ever one valid (sort, dir) pair
// on screen instead of a cross-product a reader could set inconsistently.
export const SORT_OPTIONS: readonly SortOption[] = [
  { sort: "createdAt", dir: "desc", label: "Newest first" },
  { sort: "createdAt", dir: "asc", label: "Oldest first" },
  { sort: "duration", dir: "desc", label: "Longest clip first" },
  { sort: "duration", dir: "asc", label: "Shortest clip first" },
];

// Exported (not local to filter-bar.tsx too) so both the inline desktop
// Select and this file's own Select share one mapping from a (sort, dir)
// pair to a single string value -- two copies is how they would drift into
// disagreeing about what a sort value means.
export function sortValueOf(sort: "createdAt" | "duration", dir: "asc" | "desc"): string {
  return `${sort}:${dir}`;
}

// Builds the next /history URL by cloning the current query and applying
// `changes` on top of it. `cursor` always drops: a filter or sort change
// reshapes the list, so resuming an old page position would show a page 2
// that no longer follows from page 1. `undefined` deletes a key, returning
// that control to its schema default rather than sending it explicitly.
export function buildFilterHref(
  current: URLSearchParams,
  changes: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams(current);
  params.delete("cursor");
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `/history?${query}` : "/history";
}

type RadioChipOption<T> = {
  value: T;
  label: string;
};

// A role="radiogroup" of role="radio" chips (F18) with the APG radio-group
// keyboard model, which a bare aria-checked toggle does not get for free:
//
//   - Roving tabindex: exactly one chip is a Tab stop -- the checked one,
//     or the first when none is checked -- so Tab enters and leaves the
//     group in one stop each way instead of once per chip.
//   - ArrowRight/ArrowDown and ArrowLeft/ArrowUp move focus to the next or
//     previous chip, wrapping at the ends; Home/End jump to the first or
//     last chip.
//   - Selection follows focus: landing on a chip by arrow key selects it
//     immediately (the same navigation a click triggers), matching the
//     native <input type="radio"> group model the role announces.
//   - Space/Enter (re)select the focused chip.
//
// A screen reader announces role="radio" as "this is a radio group, arrow
// keys move between options" -- without this, the arrow keys silently do
// nothing, which is worse than not claiming the role at all.
function RadioChipGroup<T extends string>({
  labelId,
  options,
  value,
  onChange,
}: {
  labelId: string;
  options: readonly RadioChipOption<T | undefined>[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = options.findIndex((option) => option.value === value);
  const tabbableIndex = checkedIndex === -1 ? 0 : checkedIndex;

  function selectAndFocus(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    // The moved-to/activated chip is found from the event target itself,
    // not from `checkedIndex` -- `value` is a prop the URL controls, and in
    // a chain of key presses it may not have caught up with where focus
    // already moved to on an earlier press in the same chain.
    const currentIndex = buttonRefs.current.indexOf(event.currentTarget);
    if (currentIndex === -1) return;
    const lastIndex = options.length - 1;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectAndFocus(currentIndex === lastIndex ? 0 : currentIndex + 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectAndFocus(currentIndex === 0 ? lastIndex : currentIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        selectAndFocus(0);
        return;
      case "End":
        event.preventDefault();
        selectAndFocus(lastIndex);
        return;
      case " ":
      case "Enter":
        event.preventDefault();
        selectAndFocus(currentIndex);
        return;
      default:
        return;
    }
  }

  return (
    <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.label}
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              // Figma "Filter chip" (16:457): the selected state is marked by
              // a check as well as by the fill, never by colour alone.
              "inline-flex min-h-11 items-center gap-1.5 rounded-pill px-(--chip-px) py-(--chip-py) type-body-sm focus-ring transition-colors",
              checked
                ? "bg-accent-strong text-bg"
                : "border border-divider bg-neutral-100 text-foreground hover:bg-neutral-200",
            )}
          >
            {checked ? <Check aria-hidden strokeWidth={2.75} className="size-3.5" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export type FilterSheetProps = {
  // The element that opens the sheet -- rendered through SheetTrigger so
  // Radix's Dialog owns focus trapping while it is open and restores focus
  // to this exact element once it closes (F20, F21).
  //
  // Omitted when the caller drives `open` itself: the design's phone row has
  // two buttons (Filter and Sort) that open this one sheet, and Radix allows
  // a single SheetTrigger. Focus still returns to whichever button was
  // clicked, because Radix restores it to whatever had focus on open.
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  statusBucket?: StatusBucket;
  style?: ArtStyle;
};

// The phone filter panel (F18, F20, F21): a role="dialog" bottom sheet whose
// status and style controls are role="radiogroup" chips. Every change is a
// server navigation to /history?... -- never a client fetch -- so the sheet
// carries no local draft state of its own; it only reads the resolved query
// values it is given and pushes a new URL on each change.
export function FilterSheet({
  trigger,
  open,
  onOpenChange,
  statusBucket,
  style,
}: FilterSheetProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusLabelId = useId();
  const styleLabelId = useId();
  const hasAnyFilter = Boolean(statusBucket || style);

  function navigate(changes: Record<string, string | undefined>) {
    router.push(buildFilterHref(searchParams, changes));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // Radix's Dialog.Content sets role="dialog" but, in the installed
        // version, no aria-modal -- F20 asks for it explicitly, so it is set
        // here rather than assumed.
        aria-modal="true"
        className="max-h-[85vh] gap-4 overflow-y-auto"
      >
        {/* Decorative drag handle -- the sheet is dismissed with the close
            button or Escape, never a gesture on this bar (F21). */}
        <div
          aria-hidden
          data-slot="sheet-grabber"
          className="mx-auto mt-4 h-[5px] w-11 shrink-0 rounded-pill bg-neutral-400"
        />
        <SheetHeader className="flex-row items-center gap-2 space-y-0">
          <SheetTitle className="flex-1">Filters</SheetTitle>
          {hasAnyFilter ? (
            <Button
              type="button"
              variant="ghost"
              size="ghost"
              onClick={() => navigate({ statusBucket: undefined, style: undefined })}
            >
              Clear all
            </Button>
          ) : null}
          <SheetClose asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Close filters">
              <XIcon aria-hidden strokeWidth={2.75} />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-(--page-margin) pb-6">
          <div className="flex flex-col gap-1.5">
            <span id={statusLabelId} className="type-caption text-ink-label">
              Status
            </span>
            <RadioChipGroup
              labelId={statusLabelId}
              options={[
                { value: undefined, label: "All" },
                ...STATUS_BUCKETS.map((bucket) => ({
                  value: bucket,
                  label: BUCKET_LABELS[bucket],
                })),
              ]}
              value={statusBucket}
              onChange={(nextValue) => navigate({ statusBucket: nextValue })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span id={styleLabelId} className="type-caption text-ink-label">
              Art style
            </span>
            <div className="max-h-48 overflow-y-auto">
              <RadioChipGroup
                labelId={styleLabelId}
                options={[
                  { value: undefined, label: "All styles" },
                  ...ART_STYLES.map((artStyle) => ({ value: artStyle, label: artStyle })),
                ]}
                value={style}
                onChange={(nextValue) => navigate({ style: nextValue })}
              />
            </div>
          </div>

          {/* Every control above navigates on change, so the list behind the
              sheet is already up to date -- this button only dismisses it. */}
          <SheetClose asChild>
            <Button type="button" className="w-full">
              Show results
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
