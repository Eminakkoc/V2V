import { useCallback, useReducer, useRef } from "react";
import { apiFetch, toErrorLike } from "@/lib/api-client";
import type { ErrorLike } from "@/lib/error-messages";
import { uploadResponseSchema, type UploadResponse } from "@/lib/upload-contract";
import type { FileToCheck, VideoRules } from "@/lib/video-rules";

export type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "storing" }
  | { status: "ready"; result: UploadResponse }
  | { status: "rejected"; error: ErrorLike }
  | { status: "failed"; error: ErrorLike };

type Action =
  | { type: "reset" }
  | { type: "started" }
  | { type: "progress"; progress: number }
  | { type: "storing" }
  | { type: "ready"; result: UploadResponse }
  | { type: "rejected"; error: ErrorLike }
  | { type: "failed"; error: ErrorLike };

function reducer(state: UploadState, action: Action): UploadState {
  switch (action.type) {
    case "reset":
      return { status: "idle" };
    case "started":
      return { status: "uploading", progress: 0 };
    case "progress":
      return state.status === "uploading"
        ? { status: "uploading", progress: Math.min(100, Math.max(0, Math.round(action.progress))) }
        : state;
    case "storing":
      return { status: "storing" };
    case "ready":
      return { status: "ready", result: action.result };
    case "rejected":
      return { status: "rejected", error: action.error };
    case "failed":
      return { status: "failed", error: action.error };
  }
}

function clientError(code: string): ErrorLike {
  return { code, message: "", retryable: false };
}

type Options = {
  onServerError?: (error: ErrorLike) => void;
  // Called with each real transition, in order, as it happens -- never
  // synthetically on mount. Driven from the same call sites that dispatch to
  // the reducer (below), not from an Effect watching `state`: an Effect fires
  // once on mount with the initial value too, which a consumer mapping "idle"
  // to "clear everything" cannot tell apart from a genuine reset.
  onStateChange?: (state: UploadState) => void;
};

export function useSourceUpload(rules: VideoRules, { onServerError, onStateChange }: Options = {}) {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  const cdnUrlRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const signatureErrorRef = useRef<ErrorLike | null>(null);
  // Mirrors `state` synchronously so `notify` can compute the exact next value
  // (via the same pure `reducer`) before React has committed it, without
  // duplicating each case's logic at the call site.
  const stateRef = useRef<UploadState>({ status: "idle" });

  const notify = useCallback(
    (action: Action) => {
      const next = reducer(stateRef.current, action);
      stateRef.current = next;
      dispatch(action);
      onStateChange?.(next);
    },
    [onStateChange],
  );

  const store = useCallback(
    async (cdnUrl: string) => {
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      notify({ type: "storing" });
      try {
        const result = await apiFetch("/api/upload", {
          body: { cdnUrl },
          schema: uploadResponseSchema,
        });
        if (attempt === attemptRef.current) notify({ type: "ready", result });
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        const problem = toErrorLike(error);
        notify({ type: "failed", error: problem });
        onServerError?.(problem);
      }
    },
    [notify, onServerError],
  );

  const select = useCallback(
    (file: FileToCheck) => {
      attemptRef.current += 1;
      cdnUrlRef.current = null;
      signatureErrorRef.current = null;
      const check = rules.checkFile(file);
      if (!check.ok) {
        notify({ type: "rejected", error: clientError(check.code) });
        return false;
      }
      notify({ type: "started" });
      return true;
    },
    [rules, notify],
  );

  const progress = useCallback(
    (percent: number) => notify({ type: "progress", progress: percent }),
    [notify],
  );

  const uploaded = useCallback(
    (cdnUrl: string) => {
      cdnUrlRef.current = cdnUrl;
      void store(cdnUrl);
    },
    [store],
  );

  const signatureFailed = useCallback((error: ErrorLike) => {
    signatureErrorRef.current = error;
  }, []);

  const uploadFailed = useCallback(() => {
    notify({
      type: "rejected",
      error: signatureErrorRef.current ?? clientError("UPLOAD_INTERRUPTED"),
    });
  }, [notify]);

  const retry = useCallback(() => {
    if (cdnUrlRef.current) void store(cdnUrlRef.current);
  }, [store]);

  const reset = useCallback(() => {
    attemptRef.current += 1;
    cdnUrlRef.current = null;
    signatureErrorRef.current = null;
    notify({ type: "reset" });
  }, [notify]);

  return { state, select, progress, uploaded, uploadFailed, signatureFailed, retry, reset };
}
