import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import type { ErrorBody } from "@/lib/error-codes";
import { AppError, errorMessage } from "./app-error";

export type ResponseHooks = { onResponse(hook: (response: Response) => void): void };

type RouteHandler = (request: NextRequest, hooks: ResponseHooks) => Promise<Response>;

export function withErrorHandling(handler: RouteHandler) {
  return async (request: NextRequest): Promise<Response> => {
    const hooks: Array<(response: Response) => void> = [];
    let response: Response;
    try {
      response = await handler(request, { onResponse: (hook) => hooks.push(hook) });
    } catch (error) {
      unstable_rethrow(error);
      response = errorResponse(toAppError(error));
    }
    for (const hook of hooks) hook(response);
    return response;
  };
}

// The client-facing message is deliberately generic, so without this the only record of why the
// provider refused would leave with the response.
function logAppError(error: AppError): void {
  const provider = error.providerError;
  if (error.status < 500 && !provider) return;
  const detail = provider ? ` (provider ${provider.code}: ${provider.message})` : "";
  console.error(`[${error.code}]`, `${errorMessage(error.cause ?? error)}${detail}`);
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    logAppError(error);
    return error;
  }
  if (error instanceof ZodError) {
    return new AppError("VALIDATION_FAILED", {
      details: {
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  console.error(error);
  return new AppError("INTERNAL");
}

function errorResponse(error: AppError): Response {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    },
  };
  const headers = new Headers();
  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return Response.json(body, { status: error.status, headers });
}
