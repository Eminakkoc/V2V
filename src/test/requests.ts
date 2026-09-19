import { NextRequest } from "next/server";
import { IDENTITY_COOKIE, signIdentity } from "@/server/services/identity";
import { testConfig } from "./env";

type RequestInit = {
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  ip?: string;
  origin?: string;
};

export function apiRequest(path: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.ip) headers.set("x-real-ip", init.ip);
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${init.origin ?? "http://localhost"}${path}`, {
    method: "POST",
    headers,
    body,
  });
}

export function identityCookie(userId: string, issuedAt = Math.floor(Date.now() / 1000)): string {
  return `${IDENTITY_COOKIE}=${signIdentity(userId, issuedAt, testConfig.sessionCookieSecret)}`;
}

export function cookieValue(response: Response): string | undefined {
  const header = response.headers.get("set-cookie");
  return header?.match(new RegExp(`${IDENTITY_COOKIE}=([^;]+)`))?.[1];
}
