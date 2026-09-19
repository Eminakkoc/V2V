export type VideoRulesSettings = { allowedFormats: readonly string[]; maxBytes: number };

export type FileCheckResult =
  { ok: true; mimeType: string } | { ok: false; code: "UNSUPPORTED_FORMAT" | "FILE_TOO_LARGE" };

export type FileToCheck = { mimeType: string | null | undefined; size: number; name?: string };

export type VideoRules = { checkFile(file: FileToCheck): FileCheckResult; accept: string };

const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
};

const GENERIC_TYPES = new Set(["", "application/octet-stream"]);

function baseType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function typeFromName(name: string): string | undefined {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  return extension ? EXTENSION_TYPES[extension] : undefined;
}

export function createVideoRules({ allowedFormats, maxBytes }: VideoRulesSettings): VideoRules {
  const allowed = new Set(allowedFormats.map((format) => format.toLowerCase()));
  const extensions = Object.entries(EXTENSION_TYPES)
    .filter(([, type]) => allowed.has(type))
    .map(([extension]) => `.${extension}`);

  return {
    accept: [...allowed, ...extensions].join(","),
    checkFile({ mimeType, size, name }) {
      const reported = baseType(mimeType);
      const resolved =
        GENERIC_TYPES.has(reported) && name ? (typeFromName(name) ?? reported) : reported;
      if (!allowed.has(resolved)) return { ok: false, code: "UNSUPPORTED_FORMAT" };
      if (size > maxBytes) return { ok: false, code: "FILE_TOO_LARGE" };
      return { ok: true, mimeType: resolved };
    },
  };
}
