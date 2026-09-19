"use client";

import "./globals.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
};

export default function GlobalError({ retry }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="flex min-h-full flex-col">
        <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-16">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p>The service is unavailable or had a problem. Try again shortly.</p>
          <button
            type="button"
            className="min-h-11 rounded-lg border px-4 font-medium"
            onClick={() => retry()}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
