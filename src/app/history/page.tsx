import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="text-muted-foreground">History is tied to this browser.</p>
      </div>
      <section
        aria-labelledby="history-empty-title"
        className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6"
      >
        <h2 id="history-empty-title" className="text-lg font-medium">
          No transformations yet
        </h2>
        <p className="text-muted-foreground">
          Your transformations will collect here, source and result side by side.
        </p>
        <Link href="/" className={buttonVariants({ className: "min-h-11" })}>
          Upload your first video
        </Link>
      </section>
    </div>
  );
}
