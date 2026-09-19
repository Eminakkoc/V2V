import type { z } from "zod";
import { errorBodySchema, type ErrorCode } from "./error-codes";
import type { ErrorLike } from "./error-messages";
import { sessionReady } from "./session-ready";

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "UPLOAD_INTERRUPTED";

type ApiErrorInit = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number | undefined;
  details?: Record<string, unknown> | undefined;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.details = init.details;
  }
}

type ApiFetchOptions<T> = {
  method?: "GET" | "POST";
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
};

const NETWORK_MESSAGE = "We could not reach the server. Check your connection and try again.";

export async function apiFetch<T>(
  path: string,
  { method = "POST", body, schema, signal }: ApiFetchOptions<T>,
): Promise<T> {
  await sessionReady();
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw networkError(0);
  }
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw toApiError(response, payload);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw networkError(response.status);
  return parsed.data;
}

export function toErrorLike(error: unknown): ErrorLike {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  return { code: "NETWORK_ERROR", message: NETWORK_MESSAGE, retryable: true };
}

function toApiError(response: Response, payload: unknown): ApiError {
  const parsed = errorBodySchema.safeParse(payload);
  if (!parsed.success) return networkError(response.status);
  const { code, message, retryable, details } = parsed.data.error;
  return new ApiError({
    status: response.status,
    code,
    message,
    retryable,
    details,
    retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function networkError(status: number): ApiError {
  return new ApiError({ status, code: "NETWORK_ERROR", message: NETWORK_MESSAGE, retryable: true });
}
