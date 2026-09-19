"use client";

import { Button } from "@/components/ui/button";
import type { ErrorMessage } from "@/lib/error-messages";

type BusyState = { status: "uploading"; progress: number } | { status: "storing" };

export function UploadProgress({ state }: { state: BusyState }) {
  const uploading = state.status === "uploading";
  const labelId = uploading ? "upload-progress-label" : "storing-label";
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <p id={labelId} className="font-medium">
        {uploading ? "Uploading your video" : "Storing your video"}
      </p>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={uploading ? state.progress : undefined}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        {uploading ? (
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${state.progress}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-primary motion-safe:animate-pulse" />
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {uploading
          ? `${state.progress}%`
          : "Copying it to secure storage. Large files take up to a minute."}
      </p>
    </div>
  );
}

type UploadErrorProps = {
  id: string;
  message: ErrorMessage;
  onRetry: () => void;
  onChooseAnother: () => void;
};

export function UploadError({ id, message, onRetry, onChooseAnother }: UploadErrorProps) {
  return (
    <div
      id={id}
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium">{message.title}</p>
        <p className="text-sm text-muted-foreground">{message.description}</p>
      </div>
      {message.action === "retry" ? (
        <Button type="button" className="min-h-11 self-start" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      {message.action === "choose-another-file" ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-start"
          onClick={onChooseAnother}
        >
          Choose another file
        </Button>
      ) : null}
    </div>
  );
}
