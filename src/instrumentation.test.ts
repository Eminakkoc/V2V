import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getConfig = vi.fn();

vi.mock("@/config/env", () => ({ getConfig }));

const originalRuntime = process.env.NEXT_RUNTIME;
const originalVercel = process.env.VERCEL;

beforeEach(() => {
  getConfig.mockReset();
  process.env.NEXT_RUNTIME = "nodejs";
  delete process.env.VERCEL;
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe("register", () => {
  it("does nothing on a runtime other than nodejs", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("./instrumentation");
    await register();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("parses the config on the nodejs runtime and does not exit when it is valid", async () => {
    getConfig.mockReturnValue({});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { register } = await import("./instrumentation");
    await register();
    expect(getConfig).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  // FND-001: a throwing register() only stops next dev on its own; next start
  // logs the error and keeps serving requests that all 500. Stop it explicitly.
  it("logs and exits the process when the config is invalid and not on Vercel", async () => {
    const error = new Error("Invalid environment: MONGODB_URI must start with mongodb://");
    getConfig.mockImplementation(() => {
      throw error;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { register } = await import("./instrumentation");
    await register();
    expect(log).toHaveBeenCalledWith(error);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs but does not exit the process when on Vercel", async () => {
    process.env.VERCEL = "1";
    const error = new Error("Invalid environment: MONGODB_URI must start with mongodb://");
    getConfig.mockImplementation(() => {
      throw error;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const { register } = await import("./instrumentation");
    await register();
    expect(log).toHaveBeenCalledWith(error);
    expect(exit).not.toHaveBeenCalled();
  });
});
