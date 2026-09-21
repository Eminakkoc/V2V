import type { NextConfig } from "next";
import { securityHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  experimental: {
    // Both pages are per-request (History is force-dynamic, Create reads the
    // identity cookie), and the client router's reuse window for such a page
    // defaults to 0 -- so every Create <-> History hop refetched the page it
    // had just discarded. Ten seconds covers doubling back without holding a
    // job's status on screen long: the shared poll corrects it on its next
    // tick either way.
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
