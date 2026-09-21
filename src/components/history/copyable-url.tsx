"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type CopyableUrlProps = {
  // Lowercase noun naming what the URL points to; it builds the visible label, the copy button's
  // accessible name and the status announcement, so none of the three can disagree.
  kind: string;
  url: string;
};

export function CopyableUrl({ kind, url }: CopyableUrlProps) {
  const [announcement, setAnnouncement] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setAnnouncement(`Copied the ${kind} URL`);
    } catch {
      setAnnouncement(`Couldn't copy the ${kind} URL`);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="shrink-0 type-caption text-muted-foreground capitalize">{kind} URL</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate rounded-pill type-body-sm text-accent-strong underline-offset-4 focus-ring hover:underline"
      >
        {url}
      </a>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Copy ${kind} URL`}
        onClick={handleCopy}
      >
        <Copy aria-hidden strokeWidth={2.75} />
      </Button>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
