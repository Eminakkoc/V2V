"use client";

import { useEffect, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import type { ErrorMessage } from "@/lib/error-messages";

type BusyState = { status: "uploading"; progress: number } | { status: "storing" };

type UploadProgressProps = {
  state: BusyState;
  // Focus target after "Try again": the label is a stable element that survives
  // the retry, so focus does not fall back to the document body.
  labelRef?: Ref<HTMLParagraphElement>;
};

export function UploadProgress({ state, labelRef }: UploadProgressProps) {
  const uploading = state.status === "uploading";
  const labelId = uploading ? "upload-progress-label" : "storing-label";
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <p id={labelId} ref={labelRef} tabIndex={-1} className="font-medium">
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

type UploadWaitRetryProps = {
  id: string;
  message: ErrorMessage;
  retryAfterSeconds: number;
  onRetry: () => void;
};

// A 429 after the bytes are already stored: the wait is real (Retry-After), but
// unlike a plain "wait" this one ends in a retry the hook can act on (the same
// cdnUrl), so the button is offered up front, disabled until the wait elapses.
// The caller only renders this while `state.status === "failed"`, so a later
// wait (a different retryAfterSeconds) arrives as a fresh mount, not a prop
// change on this instance — `ready` starting at false is enough on its own.
export function UploadWaitRetry({ id, message, retryAfterSeconds, onRetry }: UploadWaitRetryProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), retryAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);

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
      <Button type="button" className="min-h-11 self-start" disabled={!ready} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
