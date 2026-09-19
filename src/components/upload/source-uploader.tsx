"use client";

import "@uploadcare/react-uploader/core.css";
import { FileUploaderRegular } from "@uploadcare/react-uploader/next";
import type { UploadCtxProvider } from "@uploadcare/react-uploader";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSourceUpload, type UploadState } from "@/hooks/use-source-upload";
import { apiFetch, toErrorLike } from "@/lib/api-client";
import { messageFor, type ErrorLike } from "@/lib/error-messages";
import { describeFormats, formatBytes } from "@/lib/format";
import { uploadSignatureSchema } from "@/lib/upload-contract";
import { createVideoRules } from "@/lib/video-rules";
import { DropZone } from "./drop-zone";
import { SourceSummary } from "./source-summary";
import { UploadError, UploadProgress } from "./upload-feedback";

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

export function SourceUploader({ settings }: { settings: UploaderSettings }) {
  const uploaderRef = useRef<UploadCtxProvider>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [ready, setReady] = useState(false);
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
  const upload = useSourceUpload(rules, { onServerError });
  const { state, signatureFailed } = upload;

  const resolveSignature = useCallback(async () => {
    try {
      return await apiFetch("/api/uploadcare-signature", { schema: uploadSignatureSchema });
    } catch (error) {
      signatureFailed(toErrorLike(error));
      throw error;
    }
  }, [signatureFailed]);

  const api = () => uploaderRef.current?.getAPI();

  // FileUploaderRegular loads its web component via a dynamic import, so the
  // widget isn't ready the instant this component mounts. A drop that lands
  // first is queued and replayed once the ref attaches, instead of being lost.
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

  function openCamera() {
    const uploader = api();
    uploader?.removeAllFiles();
    uploader?.setCurrentActivity("camera");
    uploader?.setModalState(true);
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
    upload.reset();
    openChooser();
  }

  function replace() {
    api()?.removeAllFiles();
    upload.reset();
  }

  const problem =
    state.status === "rejected" || state.status === "failed"
      ? messageFor(state.error, limits)
      : null;
  const hint = `${describeFormats(settings.allowedFormats)} · up to ${formatBytes(settings.maxBytes)} · pick a clip of up to ${settings.maxClipSeconds} seconds next`;

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
        sourceList="local, camera"
        cameraModes="video"
        qualityInsights={false}
        secureUploadsSignatureResolver={resolveSignature}
        onFileAdded={(entry) => {
          if (!upload.select({ name: entry.name, mimeType: entry.mimeType, size: entry.size })) {
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
      {state.status === "ready" ? (
        <SourceSummary result={state.result} onReplace={replace} />
      ) : state.status === "uploading" || state.status === "storing" ? (
        <UploadProgress state={state} />
      ) : (
        <DropZone
          hint={hint}
          invalid={problem !== null}
          describedBy={problem ? ERROR_ID : undefined}
          disabled={!ready}
          onFile={addDroppedFile}
          onChoose={openChooser}
          onRecord={openCamera}
        />
      )}
      {problem ? (
        <UploadError
          id={ERROR_ID}
          message={problem}
          onRetry={upload.retry}
          onChooseAnother={chooseAnother}
        />
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcementFor(state)}
      </p>
    </div>
  );
}
