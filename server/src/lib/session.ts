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
  // The signed-in account's User Roles record id — see services/userAccess.ts's
  // UserAccess.userRoleId for why this is resolved once at login rather than looked
  // up again wherever "who did this" needs to be recorded (e.g. Levelups.Issuer).
  // Present for every role except "Student", which has no User Roles row at all.
  userRoleId?: string;
  // Present only for role === "Student" — the Members record this session is scoped
  // to, minted by the separate student app (studentApp.ts). Mutually exclusive with
  // userRoleId: a session is either User-Roles-backed (staff/kiosk) or
  // Members-backed (student), never both.
  studentId?: string;
  expires: number;
}

function sign(value: string): string {
  return createHmac("sha256", config.SESSION_SECRET).update(value).digest("base64url");
}

// Returns the cookie VALUE only (not a Set-Cookie header) — the caller sets it via the
// framework's own cookie helper (see routes/auth.ts).
export function createSessionValue(user: {
  email: string;
  role: UserRole;
  permissions: Permission[];
  userRoleId?: string;
  studentId?: string;
}): string {
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
  // A cookie without a permissions array is invalid — reject it here instead of
  // crashing downstream on .includes().
  if (!Array.isArray(payload.permissions)) return null;
  // A Student session is identified by studentId (no User Roles row exists for it);
  // every other role must carry userRoleId — same "re-auth to pick up the new shape"
  // tradeoff already accepted when userRoleId was first added.
  if (payload.role === "Student") {
    if (typeof payload.studentId !== "string") return null;
  } else if (typeof payload.userRoleId !== "string") {
    return null;
  }
  if (typeof payload.expires !== "number" || Date.now() > payload.expires) return null;
  return payload;
}

export const SESSION_COOKIE_NAME = "oz_session";
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;

// Short-lived cookie holding the OAuth `state` value between the redirect to Google and
// the callback — just CSRF protection for the login flow, not the real session.
export const OAUTH_STATE_COOKIE_NAME = "oz_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
