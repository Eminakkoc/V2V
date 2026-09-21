import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors/app-error";
import { testConfig } from "@/test/env";
import { createMagicHourAdapter, type MagicHourCreate, type MagicHourGet } from "./magic-hour";
import type { CreateJobInput } from "./types";

const input: CreateJobInput = {
  jobId: "65f000000000000000000001",
  videoUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mp4",
  params: {
    name: "beach clip",
    startSeconds: 1.5,
    endSeconds: 6.25,
    fpsResolution: "HALF",
    artStyle: "Watercolor",
    promptType: "custom",
    prompt: "neon city",
    model: "default",
    version: "default",
  },
};

const adapter = (over: { create?: MagicHourCreate; get?: MagicHourGet } = {}) =>
  createMagicHourAdapter(testConfig.magicHour, {
    create: over.create ?? vi.fn(async () => ({ id: "mh-1", creditsCharged: 12 })),
    get: over.get ?? vi.fn(async () => ({ id: "mh-1", status: "complete" })),
  });

const httpError = (status: number) => Object.assign(new Error("boom"), { status });

// The SDK throws with the provider's Response still unread, so a fixture has to keep the body
// behind text().
const httpErrorWithBody = (status: number, body: string) =>
  Object.assign(new Error("boom"), { response: { status, text: async () => body } });

describe("createJob", () => {
  it("sends the Cloudinary URL, the clip window and the style, and returns only the id", async () => {
    const create = vi.fn<MagicHourCreate>(async () => ({ id: "mh-1", creditsCharged: 12 }));
    const result = await adapter({ create }).createJob(input);
    expect(result).toEqual({ magicHourId: "mh-1" });
    const sent = create.mock.calls[0]![0];
    expect(sent.assets).toEqual({ videoSource: "file", videoFilePath: input.videoUrl });
    expect(sent.startSeconds).toBe(1.5);
    expect(sent.endSeconds).toBe(6.25);
    expect(sent.fpsResolution).toBe("HALF");
    expect(sent.style).toMatchObject({
      artStyle: "Watercolor",
      promptType: "custom",
      prompt: "neon city",
    });
    expect(sent.name).toContain(input.jobId);
  });

  it("never sends width or height, which the SDK deprecated", async () => {
    const create = vi.fn<MagicHourCreate>(async () => ({ id: "mh-1", creditsCharged: 12 }));
    await adapter({ create }).createJob(input);
    const sent = create.mock.calls[0]![0];
    expect(sent).not.toHaveProperty("width");
    expect(sent).not.toHaveProperty("height");
  });

  it.each([
    [402, "MAGIC_HOUR_INSUFFICIENT_CREDITS"],
    [422, "MAGIC_HOUR_INVALID_PARAMS"],
    [401, "MAGIC_HOUR_MISCONFIGURED"],
  ])("classifies a %s as the definite rejection %s", async (status, code) => {
    const create = vi.fn(async () => {
      throw httpError(status);
    });
    const attempt = adapter({ create }).createJob(input);
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ code, details: { definite: true } });
  });

  it("keeps the provider's own reason for the rejection, which the status alone does not give", async () => {
    const create = vi.fn(async () => {
      throw httpErrorWithBody(
        422,
        JSON.stringify({
          code: "unprocessable_entity",
          message: "V3 models are not available yet.",
        }),
      );
    });
    await expect(adapter({ create }).createJob(input)).rejects.toMatchObject({
      code: "MAGIC_HOUR_INVALID_PARAMS",
      providerError: {
        code: "unprocessable_entity",
        message: "V3 models are not available yet.",
      },
    });
  });

  it("never lets the provider's words reach the browser-facing details", async () => {
    const create = vi.fn(async () => {
      throw httpErrorWithBody(422, JSON.stringify({ code: "x", message: "internal detail" }));
    });
    await expect(adapter({ create }).createJob(input)).rejects.toMatchObject({
      details: { definite: true },
    });
    const error = await adapter({ create })
      .createJob(input)
      .catch((e: unknown) => e);
    expect((error as AppError).details).toEqual({ definite: true });
  });

  it.each([
    ["not JSON at all", "<html>502 Bad Gateway</html>"],
    ["JSON without a message", JSON.stringify({ code: "x" })],
    ["an empty message", JSON.stringify({ code: "x", message: "" })],
  ])("classifies normally when the body is %s", async (_label, body) => {
    const create = vi.fn(async () => {
      throw httpErrorWithBody(422, body);
    });
    const error = await adapter({ create })
      .createJob(input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("MAGIC_HOUR_INVALID_PARAMS");
    expect((error as AppError).providerError).toBeUndefined();
  });

  it("survives a response whose body has already been consumed", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("boom"), {
        response: {
          status: 422,
          text: async () => {
            throw new TypeError("body used already");
          },
        },
      });
    });
    const error = await adapter({ create })
      .createJob(input)
      .catch((e: unknown) => e);
    expect((error as AppError).code).toBe("MAGIC_HOUR_INVALID_PARAMS");
    expect((error as AppError).providerError).toBeUndefined();
  });

  it.each([500, 502, 503, 504])("classifies a %s as an uncertain outcome", async (status) => {
    const create = vi.fn(async () => {
      throw httpError(status);
    });
    await expect(adapter({ create }).createJob(input)).rejects.toMatchObject({
      code: "MAGIC_HOUR_REQUEST_FAILED",
      details: { definite: false },
    });
  });

  it("treats a connection that never opened as definite", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    await expect(adapter({ create }).createJob(input)).rejects.toMatchObject({
      code: "MAGIC_HOUR_REQUEST_FAILED",
      details: { definite: true },
    });
  });

  it("treats a timeout as uncertain", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    });
    await expect(adapter({ create }).createJob(input)).rejects.toMatchObject({
      code: "MAGIC_HOUR_REQUEST_FAILED",
      details: { definite: false },
    });
  });

  it("omits the prompt entirely when the type is default", async () => {
    const create = vi.fn<MagicHourCreate>(async () => ({ id: "mh-1", creditsCharged: 1 }));
    await adapter({ create }).createJob({
      ...input,
      params: { ...input.params, promptType: "default", prompt: undefined },
    });
    expect(create.mock.calls[0]![0].style).not.toHaveProperty("prompt");
  });
});

describe("getJobDetails", () => {
  it("normalises downloads, credits and error, leaking no SDK shape", async () => {
    const get = vi.fn(async () => ({
      id: "mh-1",
      status: "complete",
      name: "v2v:65f000000000000000000001 beach",
      downloads: [{ url: "https://videos.magichour.ai/mh-1/output.mp4", expiresAt: "2026-09-21" }],
      creditsCharged: 42,
      error: null,
      enabled: true,
      fps: 30,
    }));
    expect(await adapter({ get }).getJobDetails("mh-1")).toEqual({
      magicHourId: "mh-1",
      status: "complete",
      name: "v2v:65f000000000000000000001 beach",
      downloads: [{ url: "https://videos.magichour.ai/mh-1/output.mp4", expiresAt: "2026-09-21" }],
      creditsCharged: 42,
      error: null,
    });
  });

  it("translates a failure into an AppError", async () => {
    const get = vi.fn(async () => {
      throw httpError(503);
    });
    await expect(adapter({ get }).getJobDetails("mh-1")).rejects.toBeInstanceOf(AppError);
  });
});
