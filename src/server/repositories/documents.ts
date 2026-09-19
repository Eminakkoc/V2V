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
