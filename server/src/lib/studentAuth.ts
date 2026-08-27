import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, readSession } from "./session.js";

// The student app's only auth primitive — deliberately not in lib/auth.ts (which
// exports requirePermission, used only by the staff app's routes). A Student session
// isn't permission-based at all: it's identity-scoped to exactly one Members record
// (session.studentId), so there's nothing to check here beyond "is this a Student
// session." The one data route this guards (GET /api/me/timeline) reads studentId
// straight off the session — no :id route param exists anywhere in this app, so
// there's no id comparison for this check (or a caller) to get wrong.
declare module "hono" {
  interface ContextVariableMap {
    student: { email: string; studentId: string };
  }
}

export async function requireStudent(c: Context, next: Next) {
  const session = readSession(getCookie(c, SESSION_COOKIE_NAME));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (session.role !== "Student" || !session.studentId) return c.json({ error: "Forbidden" }, 403);
  c.set("student", { email: session.email, studentId: session.studentId });
  await next();
}
