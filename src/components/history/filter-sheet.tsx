"use client";

import { XIcon } from "lucide-react";
import { useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
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

function sortValueOf(sort: "createdAt" | "duration", dir: "asc" | "desc"): string {
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

function RadioChip({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "min-h-11 min-w-11 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-hidden",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export type FilterSheetProps = {
  // The element that opens the sheet -- rendered through SheetTrigger so
  // Radix's Dialog owns focus trapping while it is open and restores focus
  // to this exact element once it closes (F20, F21).
  trigger: React.ReactNode;
  statusBucket?: StatusBucket;
  style?: ArtStyle;
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  includePrevious: boolean;
  // F15: nothing to sort while the list is empty.
  isListEmpty: boolean;
};

// The phone filter panel (F18, F20, F21): a role="dialog" bottom sheet whose
// status and style controls are role="radiogroup" chips. Every change is a
// server navigation to /history?... -- never a client fetch -- so the sheet
// carries no local draft state of its own; it only reads the resolved query
// values it is given and pushes a new URL on each change.
export function FilterSheet({
  trigger,
  statusBucket,
  style,
  sort,
  dir,
  includePrevious,
  isListEmpty,
}: FilterSheetProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusLabelId = useId();
  const styleLabelId = useId();
  const includePreviousId = useId();

  function navigate(changes: Record<string, string | undefined>) {
    router.push(buildFilterHref(searchParams, changes));
  }

  const sortValue = sortValueOf(sort, dir);
  const currentSortLabel =
    SORT_OPTIONS.find((option) => sortValueOf(option.sort, option.dir) === sortValue)?.label ?? "";

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
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
        <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
        <SheetHeader className="flex-row items-center justify-between space-y-0">
          <SheetTitle>Filters</SheetTitle>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Close filters">
              <XIcon aria-hidden className="size-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <div className="flex flex-col gap-2">
            <span id={statusLabelId} className="text-sm font-medium">
              Status
            </span>
            <div role="radiogroup" aria-labelledby={statusLabelId} className="flex flex-wrap gap-2">
              <RadioChip
                checked={statusBucket === undefined}
                onSelect={() => navigate({ statusBucket: undefined })}
              >
                All
              </RadioChip>
              {STATUS_BUCKETS.map((bucket) => (
                <RadioChip
                  key={bucket}
                  checked={statusBucket === bucket}
                  onSelect={() => navigate({ statusBucket: bucket })}
                >
                  {BUCKET_LABELS[bucket]}
                </RadioChip>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span id={styleLabelId} className="text-sm font-medium">
              Style
            </span>
            <div
              role="radiogroup"
              aria-labelledby={styleLabelId}
              className="flex max-h-48 flex-wrap gap-2 overflow-y-auto"
            >
              <RadioChip
                checked={style === undefined}
                onSelect={() => navigate({ style: undefined })}
              >
                All styles
              </RadioChip>
              {ART_STYLES.map((artStyle) => (
                <RadioChip
                  key={artStyle}
                  checked={style === artStyle}
                  onSelect={() => navigate({ style: artStyle })}
                >
                  {artStyle}
                </RadioChip>
              ))}
            </div>
          </div>

          {isListEmpty ? null : (
            <Select
              value={sortValue}
              onValueChange={(value) => {
                const option = SORT_OPTIONS.find(
                  (candidate) => sortValueOf(candidate.sort, candidate.dir) === value,
                );
                if (!option) return;
                navigate({ sort: option.sort, dir: option.dir });
              }}
            >
              <SelectTrigger className="w-full" aria-label={`Sort: ${currentSortLabel}`}>
                Sort: {currentSortLabel}
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem
                    key={sortValueOf(option.sort, option.dir)}
                    value={sortValueOf(option.sort, option.dir)}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={includePreviousId}
              checked={includePrevious}
              onChange={() => navigate({ includePrevious: includePrevious ? undefined : "true" })}
              className="h-5 w-5 rounded border-input"
            />
            <Label htmlFor={includePreviousId}>Include previous attempts</Label>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
