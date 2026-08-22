import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { config } from "../config.js";
import {
  createSessionValue,
  readSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_SECONDS,
} from "../lib/session.js";
import { getAccessForEmail } from "../services/userAccess.js";

export const authRoutes = new Hono();

const isProd = process.env.NODE_ENV === "production";
const GOOGLE_REDIRECT_URI = `${config.APP_ORIGIN}/api/auth/google/callback`;

// Kicks off the OAuth code flow — a real top-level navigation (not fetch), since Google
// needs to redirect the browser itself. `state` is just CSRF protection for the login
// flow, stored in a short-lived cookie and checked back on the callback.
authRoutes.get("/auth/google/start", (c) => {
  const state = randomBytes(16).toString("hex");
  setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRoutes.get("/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, OAUTH_STATE_COOKIE_NAME);
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: "/" });

  const validState =
    !!code &&
    !!state &&
    !!cookieState &&
    state.length === cookieState.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(cookieState));
  if (!validState) return c.redirect(`${config.APP_ORIGIN}/?authError=oauth_failed`);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code!,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return c.redirect(`${config.APP_ORIGIN}/?authError=oauth_failed`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return c.redirect(`${config.APP_ORIGIN}/?authError=oauth_failed`);

  const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userinfoRes.ok) return c.redirect(`${config.APP_ORIGIN}/?authError=oauth_failed`);
  const { email, verified_email } = (await userinfoRes.json()) as {
    email?: string;
    verified_email?: boolean;
  };
  if (!email || !verified_email) return c.redirect(`${config.APP_ORIGIN}/?authError=oauth_failed`);

  const access = await getAccessForEmail(email);
  if (!access) return c.redirect(`${config.APP_ORIGIN}/?authError=not_authorized`);

  setCookie(c, SESSION_COOKIE_NAME, createSessionValue({ email, role: access.role, permissions: access.permissions }), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return c.redirect(config.APP_ORIGIN + "/");
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/session", (c) => {
  const session = readSession(getCookie(c, SESSION_COOKIE_NAME));
  if (!session) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    email: session.email,
    role: session.role,
    permissions: session.permissions,
  });
});
