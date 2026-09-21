// Enumeration shared by storage-inventory.ts and storage-clear.ts: what is actually in each
// provider, asked of the provider rather than of our own database, so a file orphaned by an upload
// that failed before its row was written is still found.
import { listOfFiles, type UploadcareSimpleAuthSchema } from "@uploadcare/rest-client";
import { v2 as cloudinary } from "cloudinary";
import { CLOUDINARY_FOLDERS } from "@/server/providers/types";

const OURS = new Set<string>(Object.values(CLOUDINARY_FOLDERS));

export function folderOf(publicId: string): string {
  return publicId.includes("/") ? publicId.slice(0, publicId.lastIndexOf("/")) : "(root)";
}

// The one safety property worth testing on its own: a public id outside the folders this app writes
// is never a deletion candidate, whatever else the account holds.
export function isOurs(publicId: string): boolean {
  return OURS.has(folderOf(publicId));
}

export type CloudinaryVideo = { publicId: string; bytes: number };

export type CloudinaryCensus = {
  ours: CloudinaryVideo[];
  // Folder -> what is in it, for everything this app does not write.
  others: Map<string, { count: number; bytes: number }>;
};

export async function cloudinaryVideos(): Promise<CloudinaryCensus> {
  const ours: CloudinaryVideo[] = [];
  const others = new Map<string, { count: number; bytes: number }>();
  let cursor: string | undefined;
  do {
    const page = await cloudinary.api.resources({
      resource_type: "video",
      type: "upload",
      max_results: 500,
      ...(cursor ? { next_cursor: cursor } : {}),
    });
    for (const { public_id, bytes } of page.resources as CloudinaryVideo[] &
      { public_id: string; bytes: number }[]) {
      if (isOurs(public_id)) {
        ours.push({ publicId: public_id, bytes });
        continue;
      }
      const folder = folderOf(public_id);
      const entry = others.get(folder) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += bytes;
      others.set(folder, entry);
    }
    cursor = page.next_cursor as string | undefined;
  } while (cursor);
  return { ours, others };
}

export type UploadcareFile = { uuid: string; bytes: number };

// `next` carries the cursor as an ISO datetime and the client's own option is a Date, so the one
// has to be parsed into the other; a page beyond the first is otherwise silently dropped.
export function cursorFrom(next: string | null | undefined): Date | undefined {
  if (!next) return undefined;
  const raw = new URL(next).searchParams.get("from");
  if (!raw) return undefined;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

export async function storedUploadcareFiles(
  authSchema: UploadcareSimpleAuthSchema,
): Promise<UploadcareFile[]> {
  const files: UploadcareFile[] = [];
  let from: Date | undefined;
  do {
    const page = await listOfFiles(
      { limit: 1000, stored: true, ...(from ? { from } : {}) },
      {
        authSchema,
      },
    );
    for (const file of page.results) {
      if (!file.datetimeRemoved) files.push({ uuid: file.uuid, bytes: file.size ?? 0 });
    }
    from = cursorFrom(page.next);
  } while (from);
  return files;
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
