// The student self-service app's entire backend — a second, deliberately minimal Hono
// app, separate from app.ts. This is the real isolation boundary described in SPEC.md:
// it never imports services/notes.ts, services/transfers.ts, services/levelups.ts,
// routes/checkins.ts, routes/students.ts (the staff one), or routes/kiosk.ts — so a
// bug here structurally cannot reach write-capable code, because that code isn't part
// of this deployment's bundle at all. (services/studentStatus.ts, which this file does
// import via studentTimeline.ts, is entirely read-only on purpose — updateStudentLevel
// lives in levelups.ts specifically so importing student status/timeline data never
// pulls in a write-capable export riding along in the same module.) Deployed as its
// own Netlify Function (netlify/functions-student/student-api.mts) at its own origin.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { config } from "./config.js";
import {
  createSessionValue,
  readSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_SECONDS,
} from "./lib/session.js";
import { requireStudent } from "./lib/studentAuth.js";
import { getStudentAccessForEmail } from "./services/userAccess.js";
import { getStudentTimeline } from "./services/studentTimeline.js";

export const studentApp = new Hono();

const isProd = process.env.NODE_ENV === "production";
const GOOGLE_REDIRECT_URI = `${config.APP_ORIGIN}/api/auth/google/callback`;

studentApp.get("/health", (c) => c.json({ ok: true }));

// Same OAuth code flow as the staff app's routes/auth.ts (state-cookie CSRF check,
// verified_email requirement) — but resolves the email via getStudentAccessForEmail
// (Members) only. No fallback to the staff User-Roles lookup at all: the two apps'
// auth stays decoupled by table, not just by deployment, so a student who mistakenly
// lands on the staff app's Google button gets the same not_authorized result as
// always, and a staff member landing here (if their email happens to also match a
// Member) just sees their own student view, same as anyone else.
studentApp.get("/api/auth/google/start", (c) => {
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

studentApp.get("/api/auth/google/callback", async (c) => {
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

  const access = await getStudentAccessForEmail(email);
  if (!access) return c.redirect(`${config.APP_ORIGIN}/?authError=not_authorized`);

  setCookie(
    c,
    SESSION_COOKIE_NAME,
    createSessionValue({ email, role: "Student", permissions: [], studentId: access.studentId }),
    { path: "/", httpOnly: true, sameSite: "Lax", secure: isProd, maxAge: SESSION_MAX_AGE_SECONDS }
  );
  return c.redirect(config.APP_ORIGIN + "/");
});

// Dev-only (same DEV_LOGIN_ENABLED=true && NODE_ENV !== "production" gating as the
// staff app's dev-login), restricted to a small fixed allowlist — not "any email,"
// for the same reason the staff dev-login is restricted to fake accounts rather than
// any real User Roles row: this must not be able to impersonate a real student just
// by knowing their email.
// - claude-student@test.com — the sandbox's fixture student (sandboxSeed.ts),
//   MOCK_AIRTABLE only.
// - ben@oaktownzouk.com — a real Member with a real Transaction (needed since
//   getStudentAccessForEmail now requires one), explicitly authorized by its owner
//   as a real-base test identity — not a fake/synthetic exception to the "can't
//   impersonate a real student" rule, since the account owner is the one granting it.
const DEV_LOGIN_STUDENT_ALLOWED_EMAILS = new Set(["claude-student@test.com", "ben@oaktownzouk.com"]);

if (config.DEV_LOGIN_ENABLED === "true" && !isProd) {
  studentApp.get("/api/auth/dev-login", async (c) => {
    const email = c.req.query("email");
    if (!email) return c.json({ error: "?email= required" }, 400);

    const normalized = email.trim().toLowerCase();
    if (!DEV_LOGIN_STUDENT_ALLOWED_EMAILS.has(normalized)) {
      console.log(`[dev-login] REJECTED (not allowlisted) email=${email} at=${new Date().toISOString()}`);
      return c.json({ error: "This email isn't allowed to use dev-login" }, 403);
    }

    const access = await getStudentAccessForEmail(normalized);
    if (!access) {
      console.log(`[dev-login] REJECTED (no Member row) email=${email} at=${new Date().toISOString()}`);
      return c.json({ error: `No Member row for ${email}` }, 404);
    }

    console.log(`[dev-login] SUCCESS email=${email} role=Student at=${new Date().toISOString()}`);
    setCookie(
      c,
      SESSION_COOKIE_NAME,
      createSessionValue({ email: normalized, role: "Student", permissions: [], studentId: access.studentId }),
      { path: "/", httpOnly: true, sameSite: "Lax", secure: isProd, maxAge: SESSION_MAX_AGE_SECONDS }
    );
    return c.redirect(config.APP_ORIGIN + "/");
  });
}

studentApp.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

studentApp.get("/api/session", (c) => {
  const session = readSession(getCookie(c, SESSION_COOKIE_NAME));
  if (!session || session.role !== "Student") return c.json({ authenticated: false });
  return c.json({ authenticated: true, email: session.email, studentId: session.studentId });
});

// The only data route — no :id param anywhere in this app. studentId comes straight
// off the session (see lib/studentAuth.ts), so there's no id comparison to get wrong.
studentApp.get("/api/me/timeline", requireStudent, async (c) => {
  const timeline = await getStudentTimeline(c.get("student").studentId);
  if (!timeline) return c.json({ error: "Student not found" }, 404);
  return c.json(timeline);
});

export default studentApp;
