import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const header = (name: string, isDevelopment = false) =>
  securityHeaders(isDevelopment).find((entry) => entry.key === name)?.value;

describe("security headers", () => {
  it("sends the standard protections", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("allows the camera and microphone for Record and denies other features", () => {
    const policy = header("Permissions-Policy") ?? "";
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("geolocation=()");
  });

  it("allows Uploadcare and Cloudinary and forbids framing", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/connect-src [^;]*https:\/\/upload\.uploadcare\.com/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/res\.cloudinary\.com/);
    expect(csp).toMatch(/media-src [^;]*https:\/\/res\.cloudinary\.com/);
    expect(csp).toContain("object-src 'none'");
  });

  it("allows the Uploadcare multipart host so large-file uploads are not blocked", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/uploadcare\.s3-accelerate\.amazonaws\.com/);
  });

  it("does not allow a wildcard amazonaws host", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).not.toContain("*.amazonaws.com");
  });

  it("allows blob: stylesheets for the uploader widget", () => {
    expect(contentSecurityPolicy(false)).toMatch(/style-src [^;]*blob:/);
  });

  it("no longer reports upload-quality telemetry", () => {
    expect(contentSecurityPolicy(false)).not.toContain("tlm.uploadcare.com");
  });

  it("allows eval only in development", () => {
    expect(contentSecurityPolicy(false)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });
});
