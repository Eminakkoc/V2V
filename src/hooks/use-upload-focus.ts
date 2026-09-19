import { useEffect, useRef } from "react";

export type UploadFocusTarget = "progress" | "dropzone";

// "Try again" and "Upload a different video" both remove the element the user
// just clicked, so focus would otherwise fall back to the document body. This
// syncs focus with the DOM (an external system) once the target status renders,
// rather than guessing during the click itself.
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
