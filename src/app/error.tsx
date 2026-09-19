"use client";

import { Button } from "@/components/ui/button";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
};

export default function ErrorPage({ retry }: ErrorPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        The service is unavailable or had a problem. Try again shortly.
      </p>
      <Button className="min-h-11" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
