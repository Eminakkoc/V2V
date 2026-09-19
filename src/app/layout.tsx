import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { TopBar } from "@/components/app-shell/top-bar";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getConfig } from "@/config/env";
import { hasFreshIdentity, IDENTITY_COOKIE } from "@/server/services/identity";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { template: "%s · V2V Transform", default: "V2V Transform" },
  description: "Restyle your videos with AI video-to-video transformation.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const needsSession = !hasFreshIdentity(
    cookieStore.get(IDENTITY_COOKIE)?.value,
    getConfig().sessionCookieSecret,
  );
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-3 focus:ring-3 focus:ring-ring"
        >
          Skip to main content
        </a>
        <TooltipProvider>
          <TopBar />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
        </TooltipProvider>
        <Toaster />
        {needsSession ? <SessionBootstrap /> : null}
      </body>
    </html>
  );
}
