import type { Metadata } from "next";
import { CreateFlow } from "@/components/create/create-flow";
import { getConfig } from "@/config/env";

export const metadata: Metadata = { title: "Create" };

export default function CreatePage() {
  const { uploadcare, upload, maxClipSeconds, cloudinary } = getConfig();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Create</h1>
        <p className="text-muted-foreground">
          Upload a video, trim the part you want, pick an art style. We hand it to the model and
          tell you the moment it lands.
        </p>
      </div>
      <CreateFlow
        settings={{
          publicKey: uploadcare.publicKey,
          allowedFormats: upload.allowedFormats,
          maxBytes: upload.maxBytes,
          maxClipSeconds,
          cloudName: cloudinary.cloudName,
        }}
      />
    </div>
  );
}
