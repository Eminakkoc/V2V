import type { Metadata } from "next";
import { Caprasimo, Figtree } from "next/font/google";
import { cookies } from "next/headers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { OfflineBanner } from "@/components/app-shell/offline-banner";
import { TopBar } from "@/components/app-shell/top-bar";
import { JobPollingProvider } from "@/components/job/job-polling-provider";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getConfig } from "@/config/env";
import { hasFreshIdentity, IDENTITY_COOKIE } from "@/server/services/identity";
import "./globals.css";

// Caprasimo ships a single weight, so headings must never ask for bold -- see the :where(h1..h6)
// rule in globals.css.
const caprasimo = Caprasimo({
  variable: "--font-caprasimo",
  weight: "400",
  subsets: ["latin"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { template: "%s · Restyle", default: "Restyle" },
  description: "Restyle your videos with AI video-to-video transformation.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const needsSession = !hasFreshIdentity(
    cookieStore.get(IDENTITY_COOKIE)?.value,
    getConfig().sessionCookieSecret,
  );
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only font-semibold text-accent-strong underline decoration-from-font focus-ring focus:not-sr-only focus:fixed focus:top-1.5 focus:left-(--page-margin) focus:z-50 focus:rounded-pill focus:bg-bg focus:px-4 focus:py-3 focus:shadow-md"
        >
          Skip to main content
        </a>
        <TooltipProvider>
          {/* Above the page, so the job poll is not torn down and restarted
              every time the router moves between Create and History. */}
          <JobPollingProvider>
            <TopBar />
            <OfflineBanner />
            <main id="main" className="flex flex-1 flex-col">
              {children}
            </main>
          </JobPollingProvider>
        </TooltipProvider>
        <Toaster />
        {needsSession ? <SessionBootstrap /> : null}
        <SpeedInsights />
      </body>
    </html>
  );
}
