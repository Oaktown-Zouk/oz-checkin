import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, isValidSessionValue } from "./session.js";

export async function requireAuth(c: Context, next: Next) {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  if (!isValidSessionValue(cookie)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
}
