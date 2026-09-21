"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  includePrevious: boolean;
  // F15: there is nothing to reorder while the list on screen is empty, so
  // the sort control is disabled. It used to be unmounted, which took a whole
  // control out of the filter row the moment a filter matched nothing --
  // the largest of this page's layout jumps (IR-008).
  isListEmpty: boolean;
};

// The Transformations tab's filter and sort controls (Task 20). Every
// control is a server navigation to /history?... -- pushed via the router,
// never fetched -- so the same query that produced the page on first load
// reproduces it on every later change (see history-filters.ts, history.ts).
//
// Tablet and up get inline Select-based controls (F25); phones collapse the
// same values into FilterSheet, a bottom sheet whose status and style
// controls are chip radiogroups (F18). Both variants read the same
// resolved query values as props, so they can never disagree about what is
// currently active.
export function FilterBar({
  statusBucket,
  style,
  sort,
  dir,
  includePrevious,
  isListEmpty,
}: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const includePreviousId = useId();

  function navigate(changes: Record<string, string | undefined>) {
    router.push(buildFilterHref(searchParams, changes));
  }

  const sortValue = sortValueOf(sort, dir);
  const currentSortLabel =
    SORT_OPTIONS.find((option) => sortValueOf(option.sort, option.dir) === sortValue)?.label ?? "";

  return (
    <div className="flex flex-col gap-3">
      {/* Tablet and up: inline controls. Each trigger's own visible text is
          "<Prefix>: <value>", so its accessible name already reads that way
          with no separate aria-labelledby needed (W4). */}
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        {/* A grid, not three w-fit controls in a row. SelectTrigger is
            `w-fit`, so each control used to be exactly as wide as its own
            label -- "Status: All" 108px, "Status: Failed" 130px, "Status:
            Complete" 153px -- and every selection shoved the controls to its
            right sideways by up to 45px. Three equal columns of a fixed-width
            row give the whole group geometry that does not depend on what is
            selected, without pinning any single control to a pixel count that
            a font change would invalidate. Each trigger takes the full column
            and truncates; its full value is still in the aria-label. */}
        <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
          <Select
            value={statusBucket ?? ALL_STATUS_VALUE}
            onValueChange={(value) =>
              navigate({ statusBucket: value === ALL_STATUS_VALUE ? undefined : value })
            }
          >
            {/* role="combobox" is not name-from-content, so the visible prefix
              needs an explicit aria-label even though it is also the trigger's
              own text (W4). */}
            <SelectTrigger
              className="w-full min-w-0 [&>span]:truncate"
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
              className="w-full min-w-0 [&>span]:truncate"
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

          {/* Kept mounted and disabled rather than unmounted (F15 hides it
            "while the list on screen is empty -- there is nothing to reorder
            yet"). Unmounting it removed a whole control from the row the
            moment a filter matched nothing, which is the largest of the
            layout jumps on this page. Disabled preserves F15's intent -- an
            empty list still cannot be reordered -- without the row changing
            shape. */}
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
              className="w-full min-w-0 [&>span]:truncate"
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

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={includePreviousId}
            checked={includePrevious}
            onChange={() => navigate({ includePrevious: includePrevious ? undefined : "true" })}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor={includePreviousId}>Include previous attempts</Label>
        </div>
      </div>

      {/* Phones: a Filter button that opens the bottom sheet. */}
      <div className="md:hidden">
        <FilterSheet
          statusBucket={statusBucket}
          style={style}
          sort={sort}
          dir={dir}
          includePrevious={includePrevious}
          isListEmpty={isListEmpty}
          trigger={
            <Button type="button" variant="outline">
              <SlidersHorizontal aria-hidden className="size-4" />
              Filter
            </Button>
          }
        />
      </div>
    </div>
  );
}
