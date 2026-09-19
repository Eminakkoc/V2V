import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { ResponseHooks } from "@/server/errors/with-error-handling";

export const IDENTITY_COOKIE = "v2v_uid";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 30 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Identity = { userId: string; issuedAt: number };

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signIdentity(userId: string, issuedAt: number, secret: string): string {
  const payload = `${userId}.${issuedAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyIdentity(value: string | undefined, secret: string): Identity | null {
  const [userId, issuedAt, signature, ...rest] = value?.split(".") ?? [];
  if (!userId || !issuedAt || !signature || rest.length > 0) return null;
  if (!UUID_PATTERN.test(userId) || !/^\d+$/.test(issuedAt)) return null;
  const expected = Buffer.from(sign(`${userId}.${issuedAt}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { userId, issuedAt: Number(issuedAt) };
}

export function hasFreshIdentity(
  value: string | undefined,
  secret: string,
  now = nowSeconds(),
): boolean {
  const identity = verifyIdentity(value, secret);
  return identity !== null && now - identity.issuedAt <= RENEW_AFTER_SECONDS;
}

function isSecureRequest(request: NextRequest): boolean {
  const { protocol, hostname } = request.nextUrl;
  return protocol === "https:" || !["localhost", "127.0.0.1"].includes(hostname);
}

function serializeCookie(value: string, secure: boolean): string {
  const attributes = [`Max-Age=${ONE_YEAR_SECONDS}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) attributes.push("Secure");
  return [`${IDENTITY_COOKIE}=${value}`, ...attributes].join("; ");
}

export function resolveUserId(
  request: NextRequest,
  secret: string,
  hooks: ResponseHooks,
  now = nowSeconds(),
): string {
  const value = request.cookies.get(IDENTITY_COOKIE)?.value;
  const current = verifyIdentity(value, secret);
  if (current && hasFreshIdentity(value, secret, now)) return current.userId;
  const userId = current?.userId ?? randomUUID();
  const cookie = serializeCookie(signIdentity(userId, now, secret), isSecureRequest(request));
  hooks.onResponse((response) => response.headers.append("Set-Cookie", cookie));
  return userId;
}
