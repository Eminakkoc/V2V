"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useReducer, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SourceUploader, type UploaderSettings } from "@/components/upload/source-uploader";
import { useJobPolling } from "@/components/job/job-polling-provider";
import type { UploadState } from "@/hooks/use-source-upload";
import { ApiError, apiFetch, toErrorLike } from "@/lib/api-client";
import { videoUrl } from "@/lib/cloudinary-urls";
import { messageFor, type ErrorLike, type ErrorMessage } from "@/lib/error-messages";
import type { HistoryJobView } from "@/lib/history-contract";
import {
  transformResponseSchema,
  type JobView,
  type TransformParams,
} from "@/lib/transform-contract";
import { defaultRange } from "@/lib/trim-range";
import type { UploadResponse } from "@/lib/upload-contract";
import { cn } from "@/lib/utils";

// Deferred so Radix's Slider, Select, Collapsible and Dialog stay out of the first load of a page
// whose only interactive surface at first paint is the drop zone; `ssr` stays on so a ?sourceId=
// arrival from History still server-renders the editor.
const Trimmer = dynamic(() => import("./trimmer").then((m) => m.Trimmer));
const OptionsForm = dynamic(() => import("./options-form").then((m) => m.OptionsForm));
const JobCard = dynamic(() => import("./job-card").then((m) => m.JobCard));
const HowItRuns = dynamic(() => import("./how-it-runs").then((m) => m.HowItRuns));

export type CreateFlowSettings = UploaderSettings & { cloudName: string };

// The poll carries only rows that can still change, so with nothing running the server's row wins.
function newestOf(
  polled: HistoryJobView | undefined,
  seeded: HistoryJobView | null,
): HistoryJobView | undefined {
  if (!seeded) return polled;
  if (!polled) return seeded;
  return Date.parse(seeded.createdAt) > Date.parse(polled.createdAt) ? seeded : polled;
}

type FlowState = {
  fileName: string | null;
  source: UploadResponse | null;
  params: TransformParams | null;
  submitting: boolean;
  // Kept only while a submission's fate is unknown, so a retry dedupes server-side; cleared on
  // success, on any edit, and on a definite rejection, which has already written a failed job under
  // this key.
  idempotencyKey: string | null;
  submitError: ErrorMessage | null;
  showJob: boolean;
};

type Action =
  | { type: "file-selected"; name: string }
  | { type: "source-ready"; source: UploadResponse; maxClipSeconds: number }
  | { type: "source-cleared" }
  | { type: "params-changed"; params: TransformParams }
  | { type: "range-changed"; range: { startSeconds: number; endSeconds: number } }
  | { type: "submit-started"; idempotencyKey: string }
  | { type: "submit-succeeded" }
  | { type: "submit-replayed-failure"; error: ErrorMessage }
  | { type: "submit-failed"; error: ErrorMessage; keepIdempotencyKey: boolean }
  | { type: "retry-started" }
  | { type: "retry-succeeded" }
  | { type: "retry-failed"; error: ErrorMessage };

const initialState: FlowState = {
  fileName: null,
  source: null,
  params: null,
  submitting: false,
  idempotencyKey: null,
  submitError: null,
  // True from mount so a job already on the account still shows before this session uploads
  // anything.
  showJob: true,
};

function defaultParams(name: string, duration: number, maxClipSeconds: number): TransformParams {
  return {
    name,
    // defaultRange, not a local Math.min: a raw source duration has more than two decimals, which
    // transformParamsSchema refuses.
    ...defaultRange(duration, maxClipSeconds),
    fpsResolution: "HALF",
    artStyle: "No Art Style",
    promptType: "default",
    model: "default",
    version: "default",
  };
}

// `definite` means the provider refused outright, and a failed job is already written under the
// key; any other failure leaves the outcome unknown, where the key is what stops a retry starting a
// second billed job.
function providerRefused(error: unknown): boolean {
  return error instanceof ApiError && error.details?.definite === true;
}

// Only the three fields the history projection keeps, so an optimistic row is shaped exactly like
// the one the next poll replaces it with.
function sourceProjection(source: UploadResponse): HistoryJobView["source"] {
  const { cloudinaryPublicId, cloudinaryUrl, duration } = source.sourceVideo;
  return { cloudinaryPublicId, cloudinaryUrl, duration };
}

// A replayed job carries the failure it was marked with rather than an HTTP error, so it has to be
// shaped into the ErrorLike the message map reads.
function jobErrorLike(job: JobView): ErrorLike {
  return {
    code: job.errorCode ?? "INTERNAL",
    message: job.errorMessage ?? "This transformation did not start.",
    retryable: false,
  };
}

// Lazy useReducer init rather than a new action: a source preloaded from History needs the same
// derived state a fresh "source-ready" produces, just computed once at mount.
function initialFlowState(initialSource: UploadResponse | null, maxClipSeconds: number): FlowState {
  if (!initialSource) return initialState;
  return {
    ...initialState,
    source: initialSource,
    params: defaultParams(
      initialSource.sourceVideo.format,
      initialSource.sourceVideo.duration,
      maxClipSeconds,
    ),
  };
}

function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case "file-selected":
      return { ...state, fileName: action.name };
    case "source-ready":
      return {
        ...state,
        source: action.source,
        params: defaultParams(
          state.fileName ?? action.source.sourceVideo.format,
          action.source.sourceVideo.duration,
          action.maxClipSeconds,
        ),
        idempotencyKey: null,
        submitError: null,
      };
    case "source-cleared":
      return { ...initialState, showJob: false };
    case "params-changed":
      return { ...state, params: action.params, idempotencyKey: null };
    case "range-changed":
      return state.params
        ? {
            ...state,
            params: { ...state.params, ...action.range },
            idempotencyKey: null,
          }
        : state;
    case "submit-started":
      return {
        ...state,
        submitting: true,
        idempotencyKey: action.idempotencyKey,
        submitError: null,
      };
    case "submit-succeeded":
      return { ...state, submitting: false, idempotencyKey: null, showJob: true };
    // The key handed back a job that had already failed: nothing new was submitted, but the job is
    // still shown as the honest answer to the click.
    case "submit-replayed-failure":
      return {
        ...state,
        submitting: false,
        idempotencyKey: null,
        submitError: action.error,
        showJob: true,
      };
    case "submit-failed":
      return {
        ...state,
        submitting: false,
        idempotencyKey: action.keepIdempotencyKey ? state.idempotencyKey : null,
        submitError: action.error,
      };
    // A retry submits a past job's stored source and params, so it leaves the draft's own
    // `idempotencyKey` alone rather than handing its next submission a stale key.
    case "retry-started":
      return { ...state, submitting: true, submitError: null };
    case "retry-succeeded":
      return { ...state, submitting: false, showJob: true };
    case "retry-failed":
      return { ...state, submitting: false, submitError: action.error };
  }
}

export function CreateFlow({
  settings,
  initialSource = null,
  initialJob = null,
  reuseCard,
}: {
  settings: CreateFlowSettings;
  // Rendered on the server and streamed in: whether there is anything to reuse is a database
  // question, and the drop zone should not wait on it.
  reuseCard?: React.ReactNode;
  // The newest job at page load, for the card shown before this session has submitted anything.
  initialJob?: HistoryJobView | null;
  // Set from page.tsx when the caller arrived via a History "Transform" link with an id that
  // resolved to a source they own; null in every other case.
  initialSource?: UploadResponse | null;
}) {
  const [state, dispatch] = useReducer(reducer, initialSource, (source) =>
    initialFlowState(source, settings.maxClipSeconds),
  );
  const { jobs, insertOptimistic, refresh, stalled } = useJobPolling();
  const previewRef = useRef<HTMLVideoElement>(null);
  // React batches the updates from two synchronous clicks before either commits, so
  // `state.submitting` alone cannot stop the second; a ref flips immediately.
  const submittingRef = useRef(false);

  const onStateChange = useCallback(
    (uploadState: UploadState) => {
      if (uploadState.status === "ready") {
        dispatch({
          type: "source-ready",
          source: uploadState.result,
          maxClipSeconds: settings.maxClipSeconds,
        });
      } else if (uploadState.status === "idle") {
        dispatch({ type: "source-cleared" });
      }
    },
    [settings.maxClipSeconds],
  );

  const onFileSelected = useCallback(
    (name: string) => dispatch({ type: "file-selected", name }),
    [],
  );

  async function handleTransform() {
    if (submittingRef.current || !state.source || !state.params) return;
    submittingRef.current = true;
    const idempotencyKey = state.idempotencyKey ?? crypto.randomUUID();
    dispatch({ type: "submit-started", idempotencyKey });
    try {
      const response = await apiFetch("/api/transform", {
        body: { sourceId: state.source.sourceId, params: state.params, idempotencyKey },
        schema: transformResponseSchema,
      });
      // The transform route answers with the bare JobView, but the card and the polling list both
      // speak the history projection.
      insertOptimistic({ ...response.job, source: sourceProjection(state.source), attempts: [] });
      // The polling hook only reschedules off its own fetch results, so a session that mounted with
      // nothing active needs this nudge to see the new job.
      refresh();
      // A 202 is not proof that anything started: the same idempotency key can hand back a job that
      // already failed.
      if (response.job.status === "failed") {
        dispatch({
          type: "submit-replayed-failure",
          error: messageFor(jobErrorLike(response.job), settings),
        });
      } else {
        dispatch({ type: "submit-succeeded" });
      }
    } catch (error) {
      dispatch({
        type: "submit-failed",
        error: messageFor(toErrorLike(error), settings),
        keepIdempotencyKey: !providerRefused(error),
      });
    } finally {
      submittingRef.current = false;
    }
  }

  // A retry re-submits a past job's own source and params, and must never reuse that job's
  // idempotency key -- doing so would just hand back the original and start nothing.
  const handleRetry = useCallback(
    async (job: HistoryJobView) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      dispatch({ type: "retry-started" });
      try {
        const response = await apiFetch("/api/transform", {
          body: {
            sourceId: job.sourceId,
            params: job.params,
            retryOfJobId: job.id,
            idempotencyKey: crypto.randomUUID(),
          },
          schema: transformResponseSchema,
        });
        // A retry re-runs the retried job's own source, so the new card can show the Source player
        // without waiting for a poll.
        insertOptimistic({ ...response.job, source: job.source, attempts: [] });
        refresh();
        dispatch({ type: "retry-succeeded" });
      } catch (error) {
        dispatch({ type: "retry-failed", error: messageFor(toErrorLike(error), settings) });
      } finally {
        submittingRef.current = false;
      }
    },
    [insertOptimistic, refresh, settings],
  );

  // Stable, so the memoized JobCard is not handed a new handler on every render of the draft
  // beneath it.
  const onRetry = useCallback((job: HistoryJobView) => void handleRetry(job), [handleRetry]);

  const source = state.source;
  const params = state.params;
  const ready = source !== null && params !== null;
  const currentJob = state.showJob ? newestOf(jobs[0], initialJob) : undefined;
  const clipSeconds = params ? params.endSeconds - params.startSeconds : 0;

  // Rendered inside OptionsForm so it sits at the foot of the form panel from tablet up; `fixed`
  // rather than `sticky` because as the form's last child it would have almost no range to stick
  // within.
  const submitRow = (
    <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-divider bg-bg px-(--page-margin) py-3 shadow-lg sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
      <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-stretch">
        <dl className="flex flex-1 items-baseline justify-between gap-2 type-body-lg sm:flex-none">
          <dt className="text-muted-foreground">Clip length</dt>
          <dd className="font-bold">{clipSeconds.toFixed(2)}s</dd>
        </dl>
        <Button
          type="button"
          size="lg"
          className="w-auto sm:w-full"
          disabled={state.submitting}
          onClick={() => void handleTransform()}
        >
          {state.submitting ? (
            <>
              <Loader2 aria-hidden className="motion-safe:animate-spin" />
              Starting…
            </>
          ) : (
            "Start transformation"
          )}
        </Button>
      </div>
      {state.submitError ? (
        <p role="alert" className="type-caption text-accent-900">
          {state.submitError.title}. {state.submitError.description}
        </p>
      ) : null}
    </div>
  );

  return (
    // pb-28 on phones keeps the last of the page clear of the pinned action bar.
    <div className={cn("flex flex-col gap-6 sm:gap-8", ready && "pb-28 sm:pb-0")}>
      {/* Figma "Desktop — empty" and "Desktop — trim & configure": one row
          whose right column is the explainer aside before a source is picked
          and the transformation form after. The uploader itself stays mounted
          across both, so the Uploadcare widget is never torn down. */}
      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:gap-(--column-gutter)">
        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-6">
          {ready ? null : (
            <div className="flex flex-col gap-3">
              <h1 className="type-h1">Restyle a clip</h1>
              <p className="max-w-(--measure) type-body-lg text-muted-foreground">
                Upload a video, trim the part you want, pick an art style. We hand it to the model
                and tell you the moment it lands.
              </p>
            </div>
          )}

          <SourceUploader
            settings={settings}
            initialResult={initialSource}
            onStateChange={onStateChange}
            onFileSelected={onFileSelected}
          />

          {ready && source && params ? (
            <>
              {/* object-contain, not the design's cover: a 1080 x 1920 source
                  cropped to a 16:9 frame would hide most of what is being
                  trimmed. The frame, radius and dark bed are the design's. */}
              <video
                ref={previewRef}
                aria-label="Uploaded video preview"
                poster={source.posterUrl}
                className="h-(--preview-height) w-full rounded-media bg-neutral-800 object-contain"
                src={videoUrl(settings.cloudName, source.sourceVideo.cloudinaryPublicId, "mp4")}
                controls
                muted
                playsInline
                preload="metadata"
              />
              <Trimmer
                duration={source.sourceVideo.duration}
                maxClipSeconds={settings.maxClipSeconds}
                value={{ startSeconds: params.startSeconds, endSeconds: params.endSeconds }}
                onChange={(range) => dispatch({ type: "range-changed", range })}
                onSeek={(second) => {
                  if (previewRef.current) previewRef.current.currentTime = second;
                }}
                disabled={state.submitting}
                src={videoUrl(settings.cloudName, source.sourceVideo.cloudinaryPublicId, "mp4")}
                previewRef={previewRef}
              />
            </>
          ) : null}

          {/* Inside the uploader's column, not below the row: the card is the
              answer to the drop zone above it and has to line up with it,
              which a full-width sibling spanning the aside as well cannot. */}
          {currentJob ? (
            <JobCard
              job={currentJob}
              cloudName={settings.cloudName}
              onRetry={onRetry}
              retryDisabled={state.submitting}
            />
          ) : null}
        </div>

        <div className={cn("shrink-0", ready ? "lg:w-[376px]" : "lg:w-(--aside-w)")}>
          {ready && source && params ? (
            <OptionsForm
              value={params}
              onChange={(next) => dispatch({ type: "params-changed", params: next })}
              disabled={state.submitting}
              footer={submitRow}
            />
          ) : (
            <HowItRuns reuseCard={reuseCard} />
          )}
        </div>
      </div>

      {stalled ? (
        <Alert role="alert">
          <AlertDescription>
            We lost track of job updates. Reload the page to check the latest status.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
