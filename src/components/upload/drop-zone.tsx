"use client";

import { Upload } from "lucide-react";
import { useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DropZoneProps = {
  formatsHint: string;
  clipHint: string;
  invalid: boolean;
  describedBy?: string | undefined;
  disabled?: boolean;
  // Focus target after "Upload a different video", so focus lands here instead of being lost when
  // the source summary unmounts.
  titleRef?: Ref<HTMLParagraphElement>;
  onFile: (file: File) => void;
  onChoose: () => void;
};

export function DropZone({
  formatsHint,
  clipHint,
  invalid,
  describedBy,
  disabled = false,
  titleRef,
  onFile,
  onChoose,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      role="group"
      aria-labelledby="drop-zone-title"
      aria-describedby={describedBy}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={cn(
        "flex flex-col items-center gap-4 rounded-card border-[length:var(--stroke-rule)] border-dashed border-accent-300 bg-dropzone px-6 py-8 text-center transition-colors sm:px-12 sm:py-16",
        dragging && "border-accent-strong bg-accent-100",
        invalid && "border-accent-900",
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-pill bg-accent-200 sm:size-[78px]">
        <Upload aria-hidden strokeWidth={2.75} className="size-7 text-accent-900 sm:size-[34px]" />
      </span>
      <div className="flex flex-col gap-1.5">
        <p id="drop-zone-title" ref={titleRef} tabIndex={-1} className="font-display type-h3">
          Drop a video here
        </p>
        <p className="type-body text-muted-foreground">{formatsHint}</p>
        <p className="type-body text-muted-foreground">{clipHint}</p>
      </div>
      <div className="flex w-full flex-col gap-3 pt-1.5 sm:w-auto sm:flex-row">
        <Button type="button" size="lg" disabled={disabled} onClick={onChoose}>
          Choose a video
        </Button>
      </div>
      <p className="type-caption text-muted-foreground">
        Stored with a hard-to-guess link. History is tied to this browser.
      </p>
    </div>
  );
}
