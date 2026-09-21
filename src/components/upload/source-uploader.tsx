"use client";

import "@uploadcare/react-uploader/core.css";
import { FileUploaderRegular } from "@uploadcare/react-uploader/next";
import type { UploadCtxProvider } from "@uploadcare/react-uploader";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSourceUpload, type UploadState } from "@/hooks/use-source-upload";
import { useUploadFocus } from "@/hooks/use-upload-focus";
import { apiFetch, toErrorLike } from "@/lib/api-client";
import { messageFor, type ErrorLike } from "@/lib/error-messages";
import { describeFormats, formatBytes } from "@/lib/format";
import { uploadSignatureSchema, type UploadResponse } from "@/lib/upload-contract";
import { createVideoRules } from "@/lib/video-rules";
import { DropZone } from "./drop-zone";
import { SourceSummary } from "./source-summary";
import { UploadError, UploadProgress, UploadWaitRetry } from "./upload-feedback";

export type UploaderSettings = {
  publicKey: string;
  allowedFormats: string[];
  maxBytes: number;
  maxClipSeconds: number;
};

const ERROR_ID = "upload-error";

function announcementFor(state: UploadState): string {
  switch (state.status) {
    case "uploading":
      return `Uploading, ${Math.floor(state.progress / 25) * 25}%`;
    case "storing":
      return "Storing your video";
    case "ready":
      return "Your video is ready";
    default:
      return "";
  }
}

// The React wrapper writes qualityInsights in a layout effect, after the element has already read
// the built-in default and sent three CSP-blocked events; the dashed attribute form puts the value
// in the initial render instead.
const TELEMETRY_OFF = { "quality-insights": "false" } as const;

export type SourceUploaderProps = {
  settings: UploaderSettings;
  // A source already uploaded in an earlier session and handed back by the History "Transform"
  // link: there is no upload to run, so this component's own state machine stays idle.
  initialResult?: UploadResponse | null;
  // `onStateChange` is forwarded straight to `useSourceUpload`, which calls it from the same places
  // it dispatches -- never from an Effect watching `state`, which would also fire once on mount
  // with the initial `idle` value.
  onStateChange?: (state: UploadState) => void;
  onFileSelected?: (name: string) => void;
};

export function SourceUploader({
  settings,
  initialResult = null,
  onStateChange,
  onFileSelected,
}: SourceUploaderProps) {
  const uploaderRef = useRef<UploadCtxProvider>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [ready, setReady] = useState(false);
  // The picker reports the file's own name and size; neither is part of the upload state machine,
  // but the design shows both.
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [restored, setRestored] = useState<UploadResponse | null>(initialResult);
  const limits = useMemo(
    () => ({ allowedFormats: settings.allowedFormats, maxBytes: settings.maxBytes }),
    [settings.allowedFormats, settings.maxBytes],
  );
  const rules = useMemo(() => createVideoRules(limits), [limits]);
  const onServerError = useCallback(
    (error: ErrorLike) => {
      if (error.retryable) toast.error(messageFor(error, limits).title);
    },
    [limits],
  );
  const upload = useSourceUpload(rules, { onServerError, onStateChange });
  const { state, signatureFailed } = upload;
  const { progressLabelRef, dropZoneTitleRef, focusAfter } = useUploadFocus(state.status);

  const resolveSignature = useCallback(async () => {
    try {
      return await apiFetch("/api/uploadcare-signature", { schema: uploadSignatureSchema });
    } catch (error) {
      signatureFailed(toErrorLike(error));
      throw error;
    }
  }, [signatureFailed]);

  const api = () => uploaderRef.current?.getAPI();

  // The widget loads its web component via a dynamic import, so a drop that lands before the ref
  // attaches is queued and replayed rather than lost.
  const setUploaderRef = useCallback((instance: UploadCtxProvider | null) => {
    uploaderRef.current = instance;
    setReady(instance !== null);
    const pending = pendingFileRef.current;
    if (instance && pending) {
      pendingFileRef.current = null;
      instance.getAPI()?.removeAllFiles();
      instance.getAPI()?.addFileFromObject(pending);
    }
  }, []);

  function openChooser() {
    api()?.removeAllFiles();
    api()?.openSystemDialog();
  }

  function addDroppedFile(file: File) {
    if (!uploaderRef.current) {
      pendingFileRef.current = file;
      return;
    }
    api()?.removeAllFiles();
    api()?.addFileFromObject(file);
  }

  function chooseAnother() {
    setSelectedFile(null);
    setRestored(null);
    upload.reset();
    openChooser();
  }

  function replace() {
    focusAfter("dropzone");
    setSelectedFile(null);
    setRestored(null);
    api()?.removeAllFiles();
    upload.reset();
  }

  function retryUpload() {
    focusAfter("progress");
    upload.retry();
  }

  const problem =
    state.status === "rejected"
      ? messageFor(state.error, limits, { stage: "rejected" })
      : state.status === "failed"
        ? messageFor(state.error, limits, { stage: "failed" })
        : null;
  const formatsHint = `${describeFormats(settings.allowedFormats)} · up to ${formatBytes(settings.maxBytes)}`;
  const clipHint = `Any length. You will pick a clip of up to ${settings.maxClipSeconds} seconds next.`;

  return (
    <div className="flex flex-col gap-4">
      <FileUploaderRegular
        headless
        ctxName="v2v-source-uploader"
        apiRef={setUploaderRef}
        pubkey={settings.publicKey}
        multiple={false}
        accept={rules.accept}
        maxLocalFileSizeBytes={settings.maxBytes}
        sourceList="local"
        qualityInsights={false}
        {...TELEMETRY_OFF}
        secureUploadsSignatureResolver={resolveSignature}
        onFileAdded={(entry) => {
          // Picking a file through the system dialog opens the widget's own upload list over our
          // progress card, which reports the same file in the design's own language. Closed here as
          // well as on the two terminal handlers, so both entry paths look the same -- a drop never
          // opens it at all.
          api()?.setModalState(false);
          if (upload.select({ name: entry.name, mimeType: entry.mimeType, size: entry.size })) {
            setSelectedFile({ name: entry.name, size: entry.size });
            onFileSelected?.(entry.name);
          } else {
            api()?.removeFileByInternalId(entry.internalId);
          }
        }}
        onFileUploadProgress={(entry) => upload.progress(entry.uploadProgress)}
        onFileUploadSuccess={(entry) => {
          api()?.setModalState(false);
          upload.uploaded(entry.cdnUrl);
        }}
        onFileUploadFailed={() => {
          api()?.setModalState(false);
          upload.uploadFailed();
        }}
      />
      {state.status === "ready" || (state.status === "idle" && restored) ? (
        <SourceSummary
          result={state.status === "ready" ? state.result : restored!}
          fileName={selectedFile?.name ?? null}
          onReplace={replace}
        />
      ) : state.status === "uploading" || state.status === "storing" ? (
        <UploadProgress
          state={state}
          file={selectedFile}
          onCancel={replace}
          labelRef={progressLabelRef}
        />
      ) : (
        <DropZone
          formatsHint={formatsHint}
          clipHint={clipHint}
          invalid={problem !== null}
          describedBy={problem ? ERROR_ID : undefined}
          disabled={!ready}
          titleRef={dropZoneTitleRef}
          onFile={addDroppedFile}
          onChoose={openChooser}
        />
      )}
      {problem && problem.action === "wait-retry" && state.status === "failed" ? (
        <UploadWaitRetry
          id={ERROR_ID}
          message={problem}
          retryAfterSeconds={state.error.retryAfterSeconds ?? 60}
          onRetry={retryUpload}
        />
      ) : problem ? (
        <UploadError
          id={ERROR_ID}
          message={problem}
          onRetry={retryUpload}
          onChooseAnother={chooseAnother}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcementFor(state)}
      </p>
    </div>
  );
}
