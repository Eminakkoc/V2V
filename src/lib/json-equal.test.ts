import { describe, expect, it } from "vitest";
import { jsonEqual } from "./json-equal";

describe("jsonEqual", () => {
  it("matches identical primitives and the same reference", () => {
    const shared = { a: 1 };
    expect(jsonEqual(shared, shared)).toBe(true);
    expect(jsonEqual("x", "x")).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(1, 1)).toBe(true);
  });

  it("separates null from an object, and a primitive from its string form", () => {
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual({}, null)).toBe(false);
    expect(jsonEqual(1, "1")).toBe(false);
  });

  it("compares nested objects by structure, not by key order", () => {
    expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } })).toBe(false);
  });

  it("compares arrays by order and length", () => {
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it("does not mistake an array for an object with numeric keys", () => {
    expect(jsonEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  // A row that gained an optional field must never read as unchanged just because the other side
  // has one fewer key.
  it("separates a missing key from an explicit undefined", () => {
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
  });
});
