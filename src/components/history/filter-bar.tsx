"use client";

import { SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { BUCKET_LABELS, STATUS_BUCKETS, type StatusBucket } from "@/lib/history-filters";
import { ART_STYLES, type ArtStyle } from "@/lib/magic-hour-styles";
import { buildFilterHref, FilterSheet, SORT_OPTIONS, sortValueOf } from "./filter-sheet";

const ALL_STATUS_VALUE = "all";
const ALL_STYLE_VALUE = "all";

export type FilterBarProps = {
  statusBucket?: StatusBucket;
  style?: ArtStyle;
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  // Disabled rather than unmounted: removing a whole control from the filter row the moment a
  // filter matched nothing was this page's largest layout jump.
  isListEmpty: boolean;
};

// Every control is a server navigation to /history?... rather than a fetch, so the query that
// produced the page reproduces it on every later change; tablet and up get inline Selects, while
// phones collapse the same values into FilterSheet.
export function FilterBar({ statusBucket, style, sort, dir, isListEmpty }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(changes: Record<string, string | undefined>) {
    router.push(buildFilterHref(searchParams, changes));
  }

  const sortValue = sortValueOf(sort, dir);
  const currentSortLabel =
    SORT_OPTIONS.find((option) => sortValueOf(option.sort, option.dir) === sortValue)?.label ?? "";
  // Shown on the phone Filter button, so the number of filters hidden inside the sheet is visible
  // without opening it.
  const activeFilterCount = [statusBucket, style].filter(Boolean).length;

  // role="combobox" is not name-from-content, so each trigger carries an explicit aria-label even
  // though its visible text already reads that way.
  return (
    <div className="flex flex-wrap items-center gap-3 md:gap-4">
      {/* Phones: the status and style filters collapse into the bottom sheet,
          whose chip radiogroups carry the same values (F18, F25). */}
      <FilterSheet
        statusBucket={statusBucket}
        style={style}
        trigger={
          <Button type="button" variant="outline" className="md:hidden">
            <SlidersHorizontal aria-hidden strokeWidth={2.75} />
            {activeFilterCount > 0 ? `Filter · ${activeFilterCount}` : "Filter"}
          </Button>
        }
      />

      {/* Fixed 190px controls, matching the design, rather than three w-fit
          ones: SelectTrigger sizes to its own label, so "Status: All" (108px)
          and "Status: Complete" (153px) used to shove every control to their
          right sideways by up to 45px on each selection. Each trigger fills
          its column and truncates; the full value stays in the aria-label. */}
      <Select
        value={statusBucket ?? ALL_STATUS_VALUE}
        onValueChange={(value) =>
          navigate({ statusBucket: value === ALL_STATUS_VALUE ? undefined : value })
        }
      >
        <SelectTrigger
          className="hidden min-w-0 md:flex md:w-[190px] [&>span]:truncate"
          aria-label={`Status: ${statusBucket ? BUCKET_LABELS[statusBucket] : "All"}`}
        >
          Status: {statusBucket ? BUCKET_LABELS[statusBucket] : "All"}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STATUS_VALUE}>All</SelectItem>
          {STATUS_BUCKETS.map((bucket) => (
            <SelectItem key={bucket} value={bucket}>
              {BUCKET_LABELS[bucket]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={style ?? ALL_STYLE_VALUE}
        onValueChange={(value) =>
          navigate({ style: value === ALL_STYLE_VALUE ? undefined : value })
        }
      >
        <SelectTrigger
          className="hidden min-w-0 md:flex md:w-[190px] [&>span]:truncate"
          aria-label={`Style: ${style ?? "All styles"}`}
        >
          Style: {style ?? "All styles"}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STYLE_VALUE}>All styles</SelectItem>
          {ART_STYLES.map((artStyle) => (
            <SelectItem key={artStyle} value={artStyle}>
              {artStyle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* The one sort control at every width -- the design shows it beside the
          Filter button on phones and in the filter row from tablet up. Kept
          mounted and disabled rather than unmounted (F15 hides it "while the
          list on screen is empty -- there is nothing to reorder yet"):
          unmounting removed a whole control from the row the moment a filter
          matched nothing, which was the largest of this page's layout jumps.
          Disabled preserves F15's intent without the row changing shape. */}
      <Select
        value={sortValue}
        disabled={isListEmpty}
        onValueChange={(value) => {
          const option = SORT_OPTIONS.find(
            (candidate) => sortValueOf(candidate.sort, candidate.dir) === value,
          );
          if (!option) return;
          navigate({ sort: option.sort, dir: option.dir });
        }}
      >
        <SelectTrigger
          className="min-w-0 flex-1 md:w-[190px] md:flex-none [&>span]:truncate"
          aria-label={`Sort: ${currentSortLabel}`}
        >
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
    </div>
  );
}
