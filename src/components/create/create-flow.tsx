"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { SourceUploader, type UploaderSettings } from "@/components/upload/source-uploader";
import { useJobPolling } from "@/hooks/use-job-polling";
import type { UploadState } from "@/hooks/use-source-upload";
import { apiFetch, toErrorLike } from "@/lib/api-client";
import { videoUrl } from "@/lib/cloudinary-urls";
import { messageFor, type ErrorMessage } from "@/lib/error-messages";
import {
  transformResponseSchema,
  type JobView,
  type TransformParams,
} from "@/lib/transform-contract";
import type { UploadResponse } from "@/lib/upload-contract";
import { cn } from "@/lib/utils";

// Deferred, not statically imported: none of the three can render before the
// reducer has a source (Trimmer/OptionsForm) or a job (JobCard), yet between
// them they pull Radix's Slider, Select, Collapsible and Dialog into the
// first load of a page whose only interactive surface at first paint is the
// drop zone. `ssr` stays on so the ?sourceId= arrival from History still
// server-renders the editor; the chunk is simply never requested on the
// ordinary visit, where the component never renders. (IR-004 / DEP-004.)
const Trimmer = dynamic(() => import("./trimmer").then((m) => m.Trimmer));
const OptionsForm = dynamic(() => import("./options-form").then((m) => m.OptionsForm));
const JobCard = dynamic(() => import("./job-card").then((m) => m.JobCard));

export type CreateFlowSettings = UploaderSettings & { cloudName: string };

type FlowState = {
  fileName: string | null;
  source: UploadResponse | null;
  params: TransformParams | null;
  submitting: boolean;
  // Kept across a retried submission of the same attempt so a dropped network
  // call dedupes server-side instead of starting (and charging for) a second
  // job. Cleared on success and on any edit, both of which start a genuinely
  // new submission that must get its own key.
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
  | { type: "submit-failed"; error: ErrorMessage }
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
  // True from mount so a job already on the account (from a previous session,
  // restored on the next poll) still shows before this session uploads anything.
  showJob: true,
};

function defaultParams(name: string, duration: number, maxClipSeconds: number): TransformParams {
  return {
    name,
    startSeconds: 0,
    endSeconds: Math.max(0.1, Math.min(duration, maxClipSeconds)),
    fpsResolution: "HALF",
    artStyle: "No Art Style",
    promptType: "default",
    model: "default",
    version: "default",
  };
}

// Lazy useReducer init (below), not a new action: an already-uploaded source
// preloaded from History (page.tsx) needs the exact same derived state a
// fresh "source-ready" produces, just computed once at mount instead of
// dispatched, so it skips SourceUploader's upload step without adding a case
// the reducer -- and its callers -- would otherwise have to account for.
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
    case "submit-failed":
      return { ...state, submitting: false, submitError: action.error };
    // A retry submits a past job's stored source and params, not the current
    // draft, so it leaves `idempotencyKey` (the draft's own retry-on-failure
    // key) alone -- touching it would hand the draft's next real submission a
    // stale key left over from an unrelated retry.
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
}: {
  settings: CreateFlowSettings;
  // Set from page.tsx when the caller arrived via a History "Transform" link
  // (/?sourceId=<id>) with an id that resolved to a source they own. null in
  // every other case -- unauthenticated, no id, or an id that didn't
  // resolve -- which is exactly today's fresh-visit behavior.
  initialSource?: UploadResponse | null;
}) {
  const [state, dispatch] = useReducer(reducer, initialSource, (source) =>
    initialFlowState(source, settings.maxClipSeconds),
  );
  const { jobs, insertOptimistic, refresh, stalled } = useJobPolling();
  const previewRef = useRef<HTMLVideoElement>(null);
  // React batches the state updates from two synchronous clicks before either
  // commits, so `state.submitting` alone can't stop a second click in the same
  // task from also passing the guard. A ref flips immediately, independent of
  // the render cycle.
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
      insertOptimistic(response.job);
      // The polling hook only reschedules itself off its own fetch results, so a
      // session that mounted with nothing active never starts checking again on
      // its own -- this new job would sit un-refreshed until a reload. Nudging a
      // fetch now hands it a live job to see, which is what starts the interval.
      refresh();
      dispatch({ type: "submit-succeeded" });
    } catch (error) {
      dispatch({ type: "submit-failed", error: messageFor(toErrorLike(error), settings) });
    } finally {
      submittingRef.current = false;
    }
  }

  // A retry is a new submission of a past job's own stored source and params
  // (never the draft currently on screen), and it must never reuse that past
  // job's idempotency key -- reusing it would just hand back the original job
  // and start nothing.
  async function handleRetry(job: JobView) {
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
      insertOptimistic(response.job);
      refresh();
      dispatch({ type: "retry-succeeded" });
    } catch (error) {
      dispatch({ type: "retry-failed", error: messageFor(toErrorLike(error), settings) });
    } finally {
      submittingRef.current = false;
    }
  }

  const source = state.source;
  const params = state.params;
  const ready = source !== null && params !== null;
  const currentJob = state.showJob ? jobs[0] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <SourceUploader
        settings={settings}
        onStateChange={onStateChange}
        onFileSelected={onFileSelected}
      />

      {ready && source && params ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <video
              ref={previewRef}
              aria-label="Uploaded video preview"
              className="aspect-video w-full rounded-lg bg-muted"
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
          </div>
          <OptionsForm
            value={params}
            onChange={(next) => dispatch({ type: "params-changed", params: next })}
            disabled={state.submitting}
          />
        </div>
      ) : null}

      {currentJob ? (
        <JobCard
          job={currentJob}
          cloudName={settings.cloudName}
          onRetry={(job) => void handleRetry(job)}
          retryDisabled={state.submitting}
        />
      ) : null}

      {stalled ? (
        <p role="alert" className="text-sm text-destructive">
          We lost track of job updates. Reload the page to check the latest status.
        </p>
      ) : null}

      {ready ? (
        <div
          className={cn(
            "sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background px-4 py-4",
            "md:static md:mx-0 md:border-0 md:bg-transparent md:p-0",
          )}
        >
          <Button
            type="button"
            className="w-full md:w-auto"
            disabled={state.submitting}
            onClick={() => void handleTransform()}
          >
            {state.submitting ? (
              <>
                <Loader2 aria-hidden className="motion-safe:animate-spin" />
                Starting…
              </>
            ) : (
              "Transform"
            )}
          </Button>
          {state.submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {state.submitError.title}. {state.submitError.description}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
