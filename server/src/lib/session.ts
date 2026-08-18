import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

// Stateless session: no server-side store to keep (fits serverless), a signed cookie
// value the client just carries. Payload is trivial (a boolean + expiry), not worth
// pulling in a session-encryption library for.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — a shared front-desk device stays logged in

function sign(value: string): string {
  return createHmac("sha256", config.SESSION_SECRET).update(value).digest("base64url");
}

// Returns the cookie VALUE only (not a Set-Cookie header) — the caller sets it via the
// framework's own cookie helper (see lib/auth.ts).
export function createSessionValue(): string {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const value = `authenticated.${expires}`;
  return `${value}.${sign(value)}`;
}

export function isValidSessionValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [kind, expiresStr, signature] = parts;
  if (kind !== "authenticated") return false;

  const expected = sign(`${kind}.${expiresStr}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const expires = Number(expiresStr);
  return Number.isFinite(expires) && Date.now() <= expires;
}

export const SESSION_COOKIE_NAME = "oz_session";
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;
