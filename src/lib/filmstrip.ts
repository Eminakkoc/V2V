// Pure time math for filmstrip thumbnails, split out from the DOM/canvas
// extraction (filmstrip.tsx) so the placement logic is testable without a
// real <video> or <canvas>.
export function thumbnailTimes(duration: number, count: number): number[] {
  if (!(duration > 0) || !(count > 0)) return [];

  // Never ask for more frames than there are whole seconds to place them in,
  // and space them so the first and last thumbnail never land on the exact
  // first or last frame of the clip.
  const effectiveCount = Math.min(Math.floor(count), Math.max(1, Math.floor(duration)));
  const step = duration / (effectiveCount + 1);

  return Array.from({ length: effectiveCount }, (_, index) => step * (index + 1));
}
