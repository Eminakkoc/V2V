"use client";

import { Camera, FolderOpen, Upload } from "lucide-react";
import { useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DropZoneProps = {
  hint: string;
  invalid: boolean;
  describedBy?: string | undefined;
  disabled?: boolean;
  // Focus target after "Upload a different video", so focus lands here instead
  // of being lost when the source summary it replaces unmounts.
  titleRef?: Ref<HTMLParagraphElement>;
  onFile: (file: File) => void;
  onChoose: () => void;
  onRecord: () => void;
};

export function DropZone({
  hint,
  invalid,
  describedBy,
  disabled = false,
  titleRef,
  onFile,
  onChoose,
  onRecord,
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
        "flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors",
        dragging && "border-primary bg-muted",
        invalid && "border-destructive",
      )}
    >
      <Upload aria-hidden className="size-8 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p id="drop-zone-title" ref={titleRef} tabIndex={-1} className="font-medium">
          Drop a video here
        </p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button type="button" className="min-h-11" disabled={disabled} onClick={onChoose}>
          <FolderOpen aria-hidden />
          <span className="sm:hidden">Camera roll</span>
          <span className="hidden sm:inline">Choose a video</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled}
          onClick={onRecord}
        >
          <Camera aria-hidden />
          <span className="sm:hidden">Record a video</span>
          <span className="hidden sm:inline">Record</span>
        </Button>
      </div>
    </div>
  );
}
