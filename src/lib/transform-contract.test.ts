import { describe, expect, it } from "vitest";
import { transformParamsSchema, transformRequestSchema } from "./transform-contract";

const valid = {
  name: "beach clip",
  startSeconds: 0,
  endSeconds: 5.25,
  fpsResolution: "HALF" as const,
  artStyle: "Watercolor" as const,
  promptType: "default" as const,
  model: "default" as const,
  version: "default" as const,
};

describe("transformParamsSchema", () => {
  it("accepts a minimal valid set and applies defaults", () => {
    const parsed = transformParamsSchema.parse({
      name: "beach clip",
      startSeconds: 0,
      endSeconds: 5.25,
      artStyle: "Watercolor",
    });
    expect(parsed.fpsResolution).toBe("HALF");
    expect(parsed.promptType).toBe("default");
    expect(parsed.model).toBe("default");
    expect(parsed.version).toBe("default");
  });

  it("rejects end at or before start", () => {
    expect(
      transformParamsSchema.safeParse({ ...valid, startSeconds: 5, endSeconds: 5 }).success,
    ).toBe(false);
  });

  it("accepts two-decimal values floating point would trip multipleOf on", () => {
    // 0.29 % 0.01 !== 0 in binary floating point; the rounding check must accept it.
    expect(transformParamsSchema.safeParse({ ...valid, startSeconds: 0.29 }).success).toBe(true);
    expect(transformParamsSchema.safeParse({ ...valid, endSeconds: 8.07 }).success).toBe(true);
  });

  it("rejects more than two decimals", () => {
    expect(transformParamsSchema.safeParse({ ...valid, startSeconds: 0.123 }).success).toBe(false);
  });

  it("requires a prompt for custom and append_default, not for default", () => {
    expect(transformParamsSchema.safeParse({ ...valid, promptType: "custom" }).success).toBe(false);
    expect(
      transformParamsSchema.safeParse({ ...valid, promptType: "append_default" }).success,
    ).toBe(false);
    expect(
      transformParamsSchema.safeParse({ ...valid, promptType: "custom", prompt: "neon city" })
        .success,
    ).toBe(true);
    expect(transformParamsSchema.safeParse({ ...valid, prompt: "ignored" }).success).toBe(true);
  });

  it("rejects an art style outside Magic Hour's list", () => {
    expect(transformParamsSchema.safeParse({ ...valid, artStyle: "Watercolour" }).success).toBe(
      false,
    );
  });

  it("has no width or height", () => {
    const parsed = transformParamsSchema.parse(valid);
    expect(parsed).not.toHaveProperty("width");
    expect(parsed).not.toHaveProperty("height");
  });
});

describe("transformRequestSchema", () => {
  it("requires a uuid idempotency key", () => {
    const body = { sourceId: "65f000000000000000000001", params: valid };
    expect(transformRequestSchema.safeParse({ ...body, idempotencyKey: "nope" }).success).toBe(
      false,
    );
    expect(
      transformRequestSchema.safeParse({
        ...body,
        idempotencyKey: "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a",
      }).success,
    ).toBe(true);
  });
});
