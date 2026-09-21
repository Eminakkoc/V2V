export function thumbnailTimes(duration: number, count: number): number[] {
  if (!(duration > 0) || !(count > 0)) return [];

  // Never ask for more frames than there are whole seconds, and space them so no thumbnail lands on
  // the exact first or last frame.
  const effectiveCount = Math.min(Math.floor(count), Math.max(1, Math.floor(duration)));
  const step = duration / (effectiveCount + 1);

  return Array.from({ length: effectiveCount }, (_, index) => step * (index + 1));
}
