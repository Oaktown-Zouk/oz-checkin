import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { config } from "../config.js";
import { createSessionValue, isValidSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../lib/session.js";

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (!body?.password || body.password !== config.CHECKIN_PASSWORD) {
    return c.json({ error: "Incorrect password" }, 401);
  }
  setCookie(c, SESSION_COOKIE_NAME, createSessionValue(), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/session", async (c) => {
  return c.json({ authenticated: isValidSessionValue(getCookie(c, SESSION_COOKIE_NAME)) });
});
