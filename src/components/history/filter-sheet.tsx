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

// One control for both sort key and direction, so there is only ever one valid (sort, dir) pair on
// screen instead of a cross-product a reader could set inconsistently.
export const SORT_OPTIONS: readonly SortOption[] = [
  { sort: "createdAt", dir: "desc", label: "Newest first" },
  { sort: "createdAt", dir: "asc", label: "Oldest first" },
  { sort: "duration", dir: "desc", label: "Longest clip first" },
  { sort: "duration", dir: "asc", label: "Shortest clip first" },
];

// Exported so the inline desktop Select and this file's own share one (sort, dir) to value mapping
// rather than drifting into disagreement.
export function sortValueOf(sort: "createdAt" | "duration", dir: "asc" | "desc"): string {
  return `${sort}:${dir}`;
}

// Clones the current query and applies `changes`; `cursor` always drops, because a reshaped list
// makes an old page position meaningless, and `undefined` deletes a key back to its schema default.
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

// A role="radiogroup" of chips with the APG keyboard model -- roving tabindex, arrow keys that
// wrap, Home/End, and selection following focus -- which a bare aria-checked toggle does not get
// for free.
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
    // Found from the event target, not from `checkedIndex`: `value` is controlled by the URL and
    // may not have caught up with where focus already moved.
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
              // The selected state is marked by a check as well as by the fill, never by colour
              // alone.
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
  // Rendered through SheetTrigger so Radix owns focus trapping and restoration; omitted when the
  // caller drives `open` itself, since the phone row has two buttons opening this one sheet and
  // Radix allows a single trigger.
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  statusBucket?: StatusBucket;
  style?: ArtStyle;
};

// Every change is a server navigation to /history?..., so the sheet carries no local draft state
// and only reads the resolved query values it is given.
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
        // Radix's Dialog.Content sets role="dialog" but, in the installed version, no aria-modal.
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
