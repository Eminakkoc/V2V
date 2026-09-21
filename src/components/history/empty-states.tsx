import { Play, SlidersHorizontal, Video } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Shown on both History tabs always, not gated on any list being empty.
export function BrowserScopedNote() {
  return <p className="type-body text-muted-foreground">History is tied to this browser.</p>;
}

function EmptyStateShell({
  headingId,
  heading,
  body,
  icon: Icon,
  action,
}: {
  headingId: string;
  heading: string;
  body: string;
  icon: typeof Play;
  action: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-center gap-4 rounded-card bg-surface px-6 py-12 text-center sm:py-16"
    >
      <span className="flex size-20 items-center justify-center rounded-pill bg-accent2-200 sm:size-24">
        <Icon aria-hidden strokeWidth={2.75} className="size-9 text-accent2-800 sm:size-[42px]" />
      </span>
      <h2 id={headingId} className="type-h3">
        {heading}
      </h2>
      <p className="max-w-[420px] type-body-lg text-muted-foreground">{body}</p>
      {action}
    </section>
  );
}

export type NoUploadsYetProps = {
  uploadHref: string;
};

export function NoUploadsYet({ uploadHref }: NoUploadsYetProps) {
  return (
    <EmptyStateShell
      headingId="no-uploads-yet-heading"
      heading="No uploads yet"
      body="Videos you upload will collect here, ready to transform again without re-uploading."
      icon={Video}
      action={
        <Link href={uploadHref} className={buttonVariants({ size: "lg" })}>
          Upload your first video
        </Link>
      }
    />
  );
}

export type NoTransformationsYetProps = {
  // Once the reader already has uploads, the call to action switches them to the tab that can
  // actually start one.
  hasUploads: boolean;
  uploadHref: string;
  switchToUploadsHref: string;
};

export function NoTransformationsYet({
  hasUploads,
  uploadHref,
  switchToUploadsHref,
}: NoTransformationsYetProps) {
  return (
    <EmptyStateShell
      headingId="no-transformations-yet-heading"
      heading="No transformations yet"
      body="Your transformations will collect here, source and result side by side. History is tied to this browser."
      icon={Play}
      action={
        hasUploads ? (
          <Link href={switchToUploadsHref} className={buttonVariants({ size: "lg" })}>
            Transform an upload
          </Link>
        ) : (
          <Link href={uploadHref} className={buttonVariants({ size: "lg" })}>
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

// Replaces that tab's "nothing yet" state rather than appearing alongside it -- a tab is never both
// empty of everything and empty of matches.
export function NoMatches({ tab, clearFiltersHref }: NoMatchesProps) {
  const body =
    tab === "uploads" ? "No uploads match your filters." : "No transformations match your filters.";
  return (
    <EmptyStateShell
      headingId="no-matches-heading"
      heading="No matches"
      body={body}
      icon={SlidersHorizontal}
      action={
        <Link
          href={clearFiltersHref}
          className={buttonVariants({ variant: "outline", size: "lg" })}
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
  // Taken as a literal prop, which is what makes the empty state dissolve the instant a live
  // refresh merges in a row that belongs on screen.
  rows: readonly unknown[];
  hasActiveFilter: boolean;
  clearFiltersHref: string;
};

// Renders nothing once `rows` is non-empty, so a caller can mount it unconditionally beside its
// real list and let it appear and disappear on its own.
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
