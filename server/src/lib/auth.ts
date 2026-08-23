import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, readSession } from "./session.js";
import type { UserRole, Permission } from "../airtable/fields.js";

// Attaches the verified session (if any) so route handlers can read who's logged in
// without re-parsing the cookie themselves.
declare module "hono" {
  interface ContextVariableMap {
    user: { email: string; role: UserRole };
  }
}

// Every route declares the single permission it needs (see docs/airtable-schema.md,
// "User Roles & Role Permissions") rather than a role — roles are just how Airtable
// groups permissions together, the app itself only ever checks permissions.
export function requirePermission(permission: Permission) {
  return async function (c: Context, next: Next) {
    const session = readSession(getCookie(c, SESSION_COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    if (!session.permissions.includes(permission)) return c.json({ error: "Forbidden" }, 403);
    c.set("user", { email: session.email, role: session.role });
    await next();
  };
}
