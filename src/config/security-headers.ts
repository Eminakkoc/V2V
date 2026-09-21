const UPLOADCARE = [
  "https://upload.uploadcare.com",
  "https://ucarecdn.com",
  "https://*.ucarecdn.com",
  "https://*.ucarecd.net",
];
// Files at or above the multipart threshold are chunked and PUT directly to this presigned S3 host.
const UPLOADCARE_MULTIPART = "https://uploadcare.s3-accelerate.amazonaws.com";
const CLOUDINARY = "https://res.cloudinary.com";
// <SpeedInsights /> loads its script from this host and reports vitals back to it, so both
// directives are needed.
const VERCEL_SPEED_INSIGHTS = "https://va.vercel-scripts.com";

export function contentSecurityPolicy(isDevelopment: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      VERCEL_SPEED_INSIGHTS,
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    // The uploader widget can create stylesheets from blob URLs.
    "style-src": ["'self'", "'unsafe-inline'", "blob:"],
    "img-src": ["'self'", "data:", "blob:", CLOUDINARY, ...UPLOADCARE],
    "media-src": ["'self'", "blob:", "mediastream:", CLOUDINARY],
    "connect-src": ["'self'", ...UPLOADCARE, UPLOADCARE_MULTIPART, VERCEL_SPEED_INSIGHTS],
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
        "camera=(), microphone=(), fullscreen=(self), geolocation=(), payment=(), usb=(), display-capture=()",
    },
  ];
}
