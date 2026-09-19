import "server-only";
import { ObjectId, type Document, type WithId } from "mongodb";
import { z } from "zod";

export function toObjectId(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

export function parseStored<S extends z.ZodObject>(
  collection: string,
  schema: S,
  document: WithId<Document>,
): z.output<S> & { id: string } {
  const result = schema.safeParse(document);
  const id = document._id.toHexString();
  if (!result.success) {
    throw new Error(
      `Stored ${collection} document ${id} failed validation: ${z.prettifyError(result.error)}`,
    );
  }
  return { ...result.data, id };
}

// A record our own server built badly (a provider response with an unexpected
// shape, for example) is our bug, not the caller's: this throws a plain Error,
// never a ZodError, so withErrorHandling reports it as a logged 500 INTERNAL
// instead of a 400 VALIDATION_FAILED that hides it and blames the request.
export function parseForWrite<S extends z.ZodObject>(
  collection: string,
  schema: S,
  input: unknown,
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid ${collection} document on write: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
