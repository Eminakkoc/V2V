import "server-only";

export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || "local";
}
