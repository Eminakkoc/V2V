import { describe, expect, it } from "vitest";
import { testEnv } from "@/test/env";
import { ConfigError, parseConfig } from "./env";

function envWith(overrides: Record<string, string | undefined>) {
  return { ...testEnv, ...overrides };
}

function errorFor(env: Record<string, string | undefined>): string {
  try {
    parseConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error("expected parseConfig to throw");
}

describe("parseConfig", () => {
  it("parses a valid environment into typed values", () => {
    const config = parseConfig(testEnv);
    expect(config.upload).toEqual({
      maxBytes: 104857600,
      allowedFormats: ["video/mp4", "video/quicktime", "video/webm"],
    });
    expect(config.maxClipSeconds).toBe(30);
    expect(config.jobGraceMinutes).toBe(120);
    expect(config.mongodb).toEqual({ uri: "mongodb://127.0.0.1:27017", dbName: "v2v_test" });
    expect(config.uploadcare.publicKey).toBe("test-public-key");
    expect(config.providerMode).toBe("real");
  });

  it("ignores unknown variables such as VERCEL_OIDC_TOKEN", () => {
    expect(() => parseConfig(envWith({ VERCEL_OIDC_TOKEN: "token" }))).not.toThrow();
  });

  it("names a missing variable", () => {
    expect(errorFor(envWith({ MONGODB_URI: undefined }))).toContain("MONGODB_URI is required");
  });

  it("reports every invalid variable in one message", () => {
    const message = errorFor(
      envWith({ MONGODB_URI: "postgres://db", SESSION_COOKIE_SECRET: "c2hvcnQ=" }),
    );
    expect(message).toContain("MONGODB_URI must start with mongodb:// or mongodb+srv://");
    expect(message).toContain("SESSION_COOKIE_SECRET must decode to at least 32 bytes");
  });

  it.each(["0", "-5", "1.5", "abc", ""])("rejects MAX_UPLOAD_BYTES=%j", (value) => {
    expect(errorFor(envWith({ MAX_UPLOAD_BYTES: value }))).toContain("MAX_UPLOAD_BYTES");
  });

  it.each(["video/mp4,,video/webm", "video/mp4,image/png", " , "])(
    "rejects ALLOWED_VIDEO_FORMATS=%j",
    (value) => {
      expect(errorFor(envWith({ ALLOWED_VIDEO_FORMATS: value }))).toContain(
        "ALLOWED_VIDEO_FORMATS",
      );
    },
  );

  it("accepts mongodb+srv URIs", () => {
    expect(
      parseConfig(envWith({ MONGODB_URI: "mongodb+srv://u:p@c.example.net" })).mongodb.uri,
    ).toBe("mongodb+srv://u:p@c.example.net");
  });

  it("allows fake providers outside Vercel", () => {
    expect(parseConfig(envWith({ PROVIDER_MODE: "fake" })).providerMode).toBe("fake");
  });

  it("refuses fake providers on Vercel", () => {
    expect(errorFor(envWith({ PROVIDER_MODE: "fake", VERCEL: "1" }))).toContain(
      "PROVIDER_MODE must not be fake on Vercel",
    );
  });
});
