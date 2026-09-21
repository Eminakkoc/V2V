export type TrimRange = { startSeconds: number; endSeconds: number };

export type TrimBounds = { duration: number; minGap: number; maxClipSeconds: number };

function clampToLimit(value: number, limit: number): number {
  return Math.min(Math.max(value, 0), limit);
}

// Raw drag/step math lands on values like 12.340000000000002, which transformParamsSchema rejects.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// The payload may not be finer than two decimals, so the track ends at the last two-decimal second
// the source actually contains -- rounding up would ask for a frame past the last one.
export function trimLimit(duration: number): number {
  return Math.floor(duration * 100) / 100;
}

// Here rather than in the caller, so the initial value and every later clampRange result come from
// one rounded source of truth.
export function defaultRange(duration: number, maxClipSeconds: number): TrimRange {
  const end = Math.max(0.1, Math.min(trimLimit(duration), maxClipSeconds));
  return { startSeconds: 0, endSeconds: round2(end) };
}

// `previous` is how this tells which handle moved: a crossing stops the dragged handle at the
// boundary, a too-close pair nudges the *other* handle open so the drag is never reversed, and a
// maxClipSeconds violation always shortens from the dragged handle.
export function clampRange(next: TrimRange, previous: TrimRange, bounds: TrimBounds): TrimRange {
  const { minGap, maxClipSeconds } = bounds;
  const limit = trimLimit(bounds.duration);

  let start = clampToLimit(next.startSeconds, limit);
  let end = clampToLimit(next.endSeconds, limit);

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

  start = clampToLimit(start, limit);
  end = clampToLimit(end, limit);

  // Re-assert the gap after the bounds clamp: at either end of the track the nudge is clamped
  // straight back and collapses both thumbs onto one value, so here the handle that still has room
  // gives way instead.
  if (end - start < minGap) {
    if (start + minGap <= limit) end = start + minGap;
    else start = Math.max(0, end - minGap);
  }

  return { startSeconds: round2(start), endSeconds: round2(end) };
}
