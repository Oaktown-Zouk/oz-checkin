import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { UserRole, Permission } from "../airtable/fields.js";

// Stateless session: no server-side store to keep (fits serverless), a signed cookie
// value the client just carries. Identity comes from Google OAuth (see routes/auth.ts);
// this module only signs/verifies the { email, role, permissions } payload we mint
// after verifying with Google and looking up Role Permissions, so we're not
// round-tripping to Airtable on every request. Permission changes in Airtable take
// effect on next login, same staleness tradeoff already accepted for role itself.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — a shared front-desk device stays logged in

export interface SessionPayload {
  email: string;
  role: UserRole;
  permissions: Permission[];
  expires: number;
}

function sign(value: string): string {
  return createHmac("sha256", config.SESSION_SECRET).update(value).digest("base64url");
}

// Returns the cookie VALUE only (not a Set-Cookie header) — the caller sets it via the
// framework's own cookie helper (see routes/auth.ts).
export function createSessionValue(user: { email: string; role: UserRole; permissions: Permission[] }): string {
  const payload: SessionPayload = { ...user, expires: Date.now() + MAX_AGE_SECONDS * 1000 };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function readSession(raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [data, signature] = parts;

  const expected = sign(data);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof payload.email !== "string" || typeof payload.role !== "string") return null;
  // Rejects cookies minted before `permissions` existed on the payload (e.g. sessions
  // from before this field was added) instead of crashing downstream on .includes().
  if (!Array.isArray(payload.permissions)) return null;
  if (typeof payload.expires !== "number" || Date.now() > payload.expires) return null;
  return payload;
}

export const SESSION_COOKIE_NAME = "oz_session";
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;

// Short-lived cookie holding the OAuth `state` value between the redirect to Google and
// the callback — just CSRF protection for the login flow, not the real session.
export const OAUTH_STATE_COOKIE_NAME = "oz_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
