import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// F5/F25: shown on both History tabs, always -- not gated on any list being
// empty. Callers render it once per tab's panel.
export function BrowserScopedNote() {
  return <p className="text-sm text-muted-foreground">History is tied to this browser.</p>;
}

function EmptyStateShell({
  headingId,
  heading,
  body,
  action,
}: {
  headingId: string;
  heading: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6"
    >
      <h2 id={headingId} className="text-lg font-medium">
        {heading}
      </h2>
      <p className="text-muted-foreground">{body}</p>
      {action}
    </section>
  );
}

export type NoUploadsYetProps = {
  uploadHref: string;
};

// The Uploaded videos tab with no filter active and no sources at all.
export function NoUploadsYet({ uploadHref }: NoUploadsYetProps) {
  return (
    <EmptyStateShell
      headingId="no-uploads-yet-heading"
      heading="No uploads yet"
      body="Videos you upload will collect here, ready to transform again without re-uploading."
      action={
        <Link href={uploadHref} className={buttonVariants({ className: "min-h-11" })}>
          Upload your first video
        </Link>
      }
    />
  );
}

export type NoTransformationsYetProps = {
  // F15: once the reader already has uploads, the call to action switches
  // them to the tab that can actually start one, instead of repeating an
  // upload entry point they have already used.
  hasUploads: boolean;
  uploadHref: string;
  switchToUploadsHref: string;
};

// The Transformations tab with no filter active and no jobs at all.
export function NoTransformationsYet({
  hasUploads,
  uploadHref,
  switchToUploadsHref,
}: NoTransformationsYetProps) {
  return (
    <EmptyStateShell
      headingId="no-transformations-yet-heading"
      heading="No transformations yet"
      body="Your transformations will collect here, source and result side by side."
      action={
        hasUploads ? (
          <Link href={switchToUploadsHref} className={buttonVariants({ className: "min-h-11" })}>
            Transform an upload
          </Link>
        ) : (
          <Link href={uploadHref} className={buttonVariants({ className: "min-h-11" })}>
            Upload your first video
          </Link>
        )
      }
    />
  );
}

export type NoMatchesProps = {
  tab: "uploads" | "transformations";
  clearFiltersHref: string;
};

// Either tab, once a filter is active and it matches nothing. Replaces that
// tab's "nothing yet" state rather than appearing alongside it (a tab is
// never both empty of everything and empty of matches at once).
export function NoMatches({ tab, clearFiltersHref }: NoMatchesProps) {
  const body =
    tab === "uploads" ? "No uploads match your filters." : "No transformations match your filters.";
  return (
    <EmptyStateShell
      headingId="no-matches-heading"
      heading="No matches"
      body={body}
      action={
        <Link
          href={clearFiltersHref}
          className={buttonVariants({ variant: "outline", className: "min-h-11" })}
        >
          Clear filters
        </Link>
      }
    />
  );
}

type HistoryEmptyStateSlot =
  | {
      tab: "uploads";
      uploadHref: string;
    }
  | {
      tab: "transformations";
      hasUploads: boolean;
      uploadHref: string;
      switchToUploadsHref: string;
    };

export type HistoryEmptyStateProps = HistoryEmptyStateSlot & {
  // The merged/current list, taken as a literal prop rather than read from
  // some other server-held value -- this is what makes the choice below
  // re-evaluate, and the empty state dissolve, the instant a live refresh
  // merges in a row that belongs on screen, with no reload.
  rows: readonly unknown[];
  hasActiveFilter: boolean;
  clearFiltersHref: string;
};

// Picks among the three "list is empty" states above for one tab. Renders
// nothing once `rows` is non-empty, so a caller can mount it unconditionally
// alongside its real list and let it appear and disappear on its own.
//
// The two "nothing yet" cases never compete: `tab` is required and each one
// only ever renders its own tab's copy, so a caller for the Uploads tab can
// never end up showing the Transformations tab's message even by mistake --
// this component has no `jobs`/upload data for the other tab to read.
export function HistoryEmptyState(props: HistoryEmptyStateProps) {
  if (props.rows.length > 0) return null;

  if (props.hasActiveFilter) {
    return <NoMatches tab={props.tab} clearFiltersHref={props.clearFiltersHref} />;
  }

  if (props.tab === "uploads") {
    return <NoUploadsYet uploadHref={props.uploadHref} />;
  }

  return (
    <NoTransformationsYet
      hasUploads={props.hasUploads}
      uploadHref={props.uploadHref}
      switchToUploadsHref={props.switchToUploadsHref}
    />
  );
}
