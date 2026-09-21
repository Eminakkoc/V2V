"use client";

import { Loader, Upload } from "lucide-react";
import { useEffect, useState, type Ref } from "react";
import { ActivityBar } from "@/components/ui/activity-bar";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ErrorMessage } from "@/lib/error-messages";
import { formatBytes } from "@/lib/format";

type BusyState = { status: "uploading"; progress: number } | { status: "storing" };

type UploadProgressProps = {
  state: BusyState;
  file?: { name: string; size: number } | null;
  onCancel?: () => void;
  // Focus target after "Try again": a stable element that survives the retry, so focus does not
  // fall back to the document body.
  labelRef?: Ref<HTMLParagraphElement>;
};

export function UploadProgress({ state, file, onCancel, labelRef }: UploadProgressProps) {
  const uploading = state.status === "uploading";
  const labelId = uploading ? "upload-progress-label" : "storing-label";
  const Icon = uploading ? Upload : Loader;

  return (
    <div className="flex flex-col gap-4 rounded-card border-[length:var(--stroke-rule)] border-dashed border-accent-300 bg-dropzone p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-accent-200">
          <Icon aria-hidden strokeWidth={2.75} className="size-5 text-accent-900" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p
            id={labelId}
            ref={labelRef}
            tabIndex={-1}
            className={
              uploading && file ? "truncate type-body-lg font-bold" : "font-display type-h4"
            }
          >
            {uploading ? (file ? file.name : "Uploading your video") : "Storing your video"}
          </p>
          <p className="type-body-sm text-muted-foreground">
            {uploading
              ? `${file ? `${formatBytes(file.size)} · ` : ""}Uploading, ${state.progress}%`
              : "Copying it to storage. Large files can take up to a minute."}
          </p>
        </div>
        {onCancel ? (
          <Button type="button" variant="ghost" size="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {uploading ? (
        <div
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.progress}
          className="h-2.5 overflow-hidden rounded-pill bg-neutral-300"
        >
          <div
            className="h-full rounded-pill bg-accent-strong transition-[width]"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      ) : (
        <ActivityBar
          className="h-2.5"
          role="progressbar"
          aria-hidden={undefined}
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      )}
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
    <Alert id={id} role="alert">
      <div className="flex flex-col">
        <AlertTitle>{message.title}</AlertTitle>
        <AlertDescription>{message.description}</AlertDescription>
      </div>
      {message.action === "retry" || message.action === "choose-another-file" ? (
        <AlertActions>
          {message.action === "retry" ? (
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onChooseAnother}>
              Choose another file
            </Button>
          )}
        </AlertActions>
      ) : null}
    </Alert>
  );
}

type UploadWaitRetryProps = {
  id: string;
  message: ErrorMessage;
  retryAfterSeconds: number;
  onRetry: () => void;
};

// The wait is real, but unlike a plain "wait" it ends in a retry the hook can act on, so the button
// is offered up front and disabled until the wait elapses; a later wait arrives as a fresh mount,
// so `ready` starting at false is enough.
export function UploadWaitRetry({ id, message, retryAfterSeconds, onRetry }: UploadWaitRetryProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), retryAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);

  return (
    <Alert id={id} role="alert">
      <div className="flex flex-col">
        <AlertTitle>{message.title}</AlertTitle>
        <AlertDescription>{message.description}</AlertDescription>
      </div>
      <AlertActions>
        <Button type="button" variant="outline" disabled={!ready} onClick={onRetry}>
          Try again
        </Button>
      </AlertActions>
    </Alert>
  );
}
