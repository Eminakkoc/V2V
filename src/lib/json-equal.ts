// Structural equality for JSON-parsed values only -- no Date, Map, Set, RegExp or cycles -- so a
// poll that fetched an identical row can keep the object the page already holds.
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  // hasOwn, not `key in right`: an inherited or absent key must not pass as a match just because
  // both sides read undefined.
  return leftKeys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}
