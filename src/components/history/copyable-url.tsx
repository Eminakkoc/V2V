"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type CopyableUrlProps = {
  // Lowercase noun naming what the URL points to ("source", "result"). Builds
  // both the copy button's accessible name (F1: "Copy result URL") and the
  // status announcement, so the two never say different things.
  kind: string;
  url: string;
};

// Per F1: a real, visible link that opens in a new tab, plus a 44px copy
// button that confirms the copy (or its failure) through a polite status
// message rather than a visual-only change.
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
    <div className="flex min-w-0 items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 text-sm wrap-anywhere text-primary underline-offset-4 hover:underline"
      >
        {url}
      </a>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Copy ${kind} URL`}
        onClick={handleCopy}
      >
        <Copy aria-hidden className="size-4" />
      </Button>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
