export type TrimRange = { startSeconds: number; endSeconds: number };

export type TrimBounds = { duration: number; minGap: number; maxClipSeconds: number };

function clampToLimit(value: number, limit: number): number {
  return Math.min(Math.max(value, 0), limit);
}

// z.multipleOf-style rounding: binary floating point makes raw drag/step math
// land on values like 12.340000000000002, which transformParamsSchema rejects.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// The furthest either handle may travel. A real source duration is almost
// never a two-decimal number -- a .mov reports 2.69973 -- and the payload may
// not be finer than two decimals, so the track has to end at the last
// two-decimal second the source actually contains. Rounding up instead would
// ask the provider for a frame past the last one.
export function trimLimit(duration: number): number {
  return Math.floor(duration * 100) / 100;
}

// The range a source starts with: the whole clip, capped at maxClipSeconds,
// already in the two-decimal space the payload uses. It lives here rather
// than in the caller so the initial value and every later clampRange result
// come from one rounded source of truth -- rounding only on MOVE is what let
// an untouched trimmer submit the raw duration and be refused server-side.
export function defaultRange(duration: number, maxClipSeconds: number): TrimRange {
  const end = Math.max(0.1, Math.min(trimLimit(duration), maxClipSeconds));
  return { startSeconds: 0, endSeconds: round2(end) };
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

  // Re-assert the gap AFTER the bounds clamp. Nudging the *other* handle open
  // (above) only works while that handle has somewhere to go; at either end of
  // the track the nudge is clamped straight back -- End on the start thumb
  // proposes (limit, limit), the nudge asks for limit + minGap, and the clamp
  // returns it to limit -- collapsing the pair onto one value and offering a
  // zero-length clip the server then refuses. Here the handle that still has
  // room gives way instead, including the dragged one: at the boundary there
  // is no alternative, and stopping the dragged handle short of the edge is
  // the same resolution a crossing already gets.
  if (end - start < minGap) {
    if (start + minGap <= limit) end = start + minGap;
    else start = Math.max(0, end - minGap);
  }

  return { startSeconds: round2(start), endSeconds: round2(end) };
}
