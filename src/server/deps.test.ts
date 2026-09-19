import { describe, expect, it } from "vitest";
import { parseConfig } from "@/config/env";
import { testEnv } from "@/test/env";
import { buildServerDeps } from "./deps";
import { FAKE_FILE_SIZE } from "./providers/fakes";

describe("buildServerDeps", () => {
  it("uses the fake providers when PROVIDER_MODE=fake", async () => {
    const deps = buildServerDeps(parseConfig({ ...testEnv, PROVIDER_MODE: "fake" }));
    await expect(
      deps.uploadcare.getFileInfo("3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a"),
    ).resolves.toMatchObject({
      size: FAKE_FILE_SIZE,
    });
  });

  it("prefers explicitly injected providers", () => {
    const providers = {
      uploadcare: { getFileInfo: async () => Promise.reject(new Error("unused")) },
      cloudinary: { copyVideoFromUrl: async () => Promise.reject(new Error("unused")) },
    };
    const deps = buildServerDeps(parseConfig(testEnv), { providers });
    expect(deps.uploadcare).toBe(providers.uploadcare);
    expect(deps.cloudinary).toBe(providers.cloudinary);
  });
});
