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

type Options = { onServerError?: (error: ErrorLike) => void };

export function useSourceUpload(rules: VideoRules, { onServerError }: Options = {}) {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  const cdnUrlRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const signatureErrorRef = useRef<ErrorLike | null>(null);

  const store = useCallback(
    async (cdnUrl: string) => {
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      dispatch({ type: "storing" });
      try {
        const result = await apiFetch("/api/upload", {
          body: { cdnUrl },
          schema: uploadResponseSchema,
        });
        if (attempt === attemptRef.current) dispatch({ type: "ready", result });
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        const problem = toErrorLike(error);
        dispatch({ type: "failed", error: problem });
        onServerError?.(problem);
      }
    },
    [onServerError],
  );

  const select = useCallback(
    (file: FileToCheck) => {
      attemptRef.current += 1;
      cdnUrlRef.current = null;
      signatureErrorRef.current = null;
      const check = rules.checkFile(file);
      if (!check.ok) {
        dispatch({ type: "rejected", error: clientError(check.code) });
        return false;
      }
      dispatch({ type: "started" });
      return true;
    },
    [rules],
  );

  const progress = useCallback(
    (percent: number) => dispatch({ type: "progress", progress: percent }),
    [],
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
    dispatch({
      type: "rejected",
      error: signatureErrorRef.current ?? clientError("UPLOAD_INTERRUPTED"),
    });
  }, []);

  const retry = useCallback(() => {
    if (cdnUrlRef.current) void store(cdnUrlRef.current);
  }, [store]);

  const reset = useCallback(() => {
    attemptRef.current += 1;
    cdnUrlRef.current = null;
    signatureErrorRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  return { state, select, progress, uploaded, uploadFailed, signatureFailed, retry, reset };
}
