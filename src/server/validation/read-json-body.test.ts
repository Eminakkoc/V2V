import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { AppError } from "@/server/errors/app-error";
import { MAX_JSON_BODY_BYTES, readJsonBody } from "./read-json-body";

const schema = z.object({ cdnUrl: z.string() });
const post = (body: BodyInit) =>
  new Request("http://localhost/api/upload", { method: "POST", body });

describe("readJsonBody", () => {
  it("parses a valid body", async () => {
    await expect(readJsonBody(post(JSON.stringify({ cdnUrl: "x" })), schema)).resolves.toEqual({
      cdnUrl: "x",
    });
  });

  it("rejects a body over the cap with REQUEST_TOO_LARGE", async () => {
    const body = JSON.stringify({ cdnUrl: "x".repeat(MAX_JSON_BODY_BYTES) });
    await expect(readJsonBody(post(body), schema)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
  });

  it("counts streamed bytes, not a declared length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(8_000));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 3) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readJsonBody(request, schema)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
    });
  });

  it("rejects invalid JSON with VALIDATION_FAILED", async () => {
    const error = await readJsonBody(post("{nope"), schema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects a schema mismatch with a ZodError", async () => {
    await expect(readJsonBody(post(JSON.stringify({})), schema)).rejects.toBeInstanceOf(ZodError);
  });
});
