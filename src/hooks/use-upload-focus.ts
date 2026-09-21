import { useEffect, useRef } from "react";

export type UploadFocusTarget = "progress" | "dropzone";

// "Try again" and "Upload a different video" both remove the element just clicked, so focus would
// fall back to the document body; this syncs it once the new status renders.
export function useUploadFocus(status: string) {
  const progressLabelRef = useRef<HTMLParagraphElement | null>(null);
  const dropZoneTitleRef = useRef<HTMLParagraphElement | null>(null);
  const pendingRef = useRef<UploadFocusTarget | null>(null);

  useEffect(() => {
    const target = pendingRef.current;
    if (target === "progress" && status === "storing") {
      pendingRef.current = null;
      progressLabelRef.current?.focus();
    } else if (target === "dropzone" && status === "idle") {
      pendingRef.current = null;
      dropZoneTitleRef.current?.focus();
    }
  }, [status]);

  function focusAfter(target: UploadFocusTarget) {
    pendingRef.current = target;
  }

  return { progressLabelRef, dropZoneTitleRef, focusAfter };
}
