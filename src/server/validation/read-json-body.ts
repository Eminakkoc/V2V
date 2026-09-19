import "server-only";
import type { z } from "zod";
import { AppError } from "@/server/errors/app-error";

export const MAX_JSON_BODY_BYTES = 16_384;

export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<z.output<S>> {
  const text = await readText(request, maxBytes);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", { message: "The request body is not valid JSON." });
  }
  return schema.parse(json);
}

async function readText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
