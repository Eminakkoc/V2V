import type { NextConfig } from "next";
import { securityHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  experimental: {
    // Both pages are per-request, and the client router's reuse window for such a page defaults to 0, so every Create <-> History hop refetched the page it had just discarded.
    staleTimes: { dynamic: 10 },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "development"),
      },
    ];
  },
};

export default nextConfig;
