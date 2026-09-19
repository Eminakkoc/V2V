const UPLOADCARE = [
  "https://upload.uploadcare.com",
  "https://ucarecdn.com",
  "https://*.ucarecdn.com",
  "https://*.ucarecd.net",
];
// The uploader widget reports upload-quality telemetry to this host.
const UPLOADCARE_TELEMETRY = "https://tlm.uploadcare.com";
const CLOUDINARY = "https://res.cloudinary.com";

export function contentSecurityPolicy(isDevelopment: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", CLOUDINARY, ...UPLOADCARE],
    "media-src": ["'self'", "blob:", "mediastream:", CLOUDINARY],
    "connect-src": ["'self'", ...UPLOADCARE, UPLOADCARE_TELEMETRY],
    "font-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function securityHeaders(isDevelopment: boolean): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDevelopment) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), microphone=(self), fullscreen=(self), geolocation=(), payment=(), usb=(), display-capture=()",
    },
  ];
}
