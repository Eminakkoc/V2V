import { cookies } from "next/headers";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getServerDeps } from "@/server/deps";
import { IDENTITY_COOKIE, verifyIdentity } from "@/server/services/identity";

// Drives the aside's "Use an earlier upload" card, which the design shows only
// when there is at least one source to reuse -- an empty account would
// otherwise be sent to an empty Uploaded videos tab. Scoped to the reader's
// own identity and asked for a single row: this is a "does anything exist"
// check, not a listing.
//
// Its own async component, suspended by the page, so the one database read the
// Create page makes on an ordinary visit never delays the drop zone.
export async function ReuseCard() {
  const deps = getServerDeps();
  const userId = verifyIdentity(
    (await cookies()).get(IDENTITY_COOKIE)?.value,
    deps.config.sessionCookieSecret,
  )?.userId;
  if (!userId) return null;
  const sources = await deps.sources.listForUser(userId, { limit: 1 });
  if (sources.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col items-start gap-2 rounded-panel bg-surface p-5 shadow-sm">
      <p className="type-eyebrow text-accent-strong uppercase">Reuse</p>
      <p className="type-h5">Use an earlier upload</p>
      <p className="type-body-sm text-foreground/80">
        Start from one of them and skip the upload entirely.
      </p>
      <Link href="/history?tab=sources" className={buttonVariants({ variant: "outline" })}>
        Browse uploads
      </Link>
    </div>
  );
}
