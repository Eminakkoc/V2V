export type TrimRange = { startSeconds: number; endSeconds: number };

export type TrimBounds = { duration: number; minGap: number; maxClipSeconds: number };

function clampToDuration(value: number, duration: number): number {
  return Math.min(Math.max(value, 0), duration);
}

// z.multipleOf-style rounding: binary floating point makes raw drag/step math
// land on values like 12.340000000000002, which transformParamsSchema rejects.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Resolves a proposed drag/edit against the last committed range. `previous`
// is how the function tells which handle moved, which decides how a
// collision is resolved:
//   - crossing (the dragged handle passed the other one): the dragged handle
//     stops at the boundary instead of the pair swapping.
//   - too close but not crossed: the *other* handle is nudged open, so the
//     drag the user just made is never reversed under them.
// A maxClipSeconds violation always shortens from the handle being dragged.
export function clampRange(next: TrimRange, previous: TrimRange, bounds: TrimBounds): TrimRange {
  const { duration, minGap, maxClipSeconds } = bounds;

  let start = clampToDuration(next.startSeconds, duration);
  let end = clampToDuration(next.endSeconds, duration);

  const startDragged = next.startSeconds !== previous.startSeconds;
  const endDragged = next.endSeconds !== previous.endSeconds;

  if (start > end) {
    if (startDragged) start = end - minGap;
    else if (endDragged) end = start + minGap;
  } else if (end - start < minGap) {
    if (startDragged) end = start + minGap;
    else if (endDragged) start = end - minGap;
  }

  if (end - start > maxClipSeconds) {
    if (startDragged) start = end - maxClipSeconds;
    else end = start + maxClipSeconds;
  }

  start = clampToDuration(start, duration);
  end = clampToDuration(end, duration);

  return { startSeconds: round2(start), endSeconds: round2(end) };
}
