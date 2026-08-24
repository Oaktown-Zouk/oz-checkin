import { Hono, type Context } from "hono";
import { requirePermission } from "../lib/auth.js";
import { listKioskRoster } from "../services/kiosk.js";
import { getStudentStatusById } from "../services/studentStatus.js";

export const kioskRoutes = new Hono();

kioskRoutes.use("*", requirePermission("Create Checkins"));

// A `?date=` override is only honored for a session that also holds Backdate Kiosk
// (Admin only) — lets an admin simulate "now" to test e.g. a Visible For window
// without waiting for a real class time. A real Kiosk-role session passing this param
// (e.g. a tampered request) gets 403'd rather than silently ignored.
function checkDateParam(c: Context) {
  const date = c.req.query("date");
  if (date && !c.get("user").permissions.includes("Backdate Kiosk")) {
    return { error: true as const };
  }
  return { error: false as const, date };
}

kioskRoutes.get("/roster", async (c) => {
  const parsed = checkDateParam(c);
  if (parsed.error) return c.json({ error: "Forbidden" }, 403);
  return c.json({ students: await listKioskRoster(parsed.date) });
});

// Fetch the status of the student, regardless of check-in eligibility so that we
// can either check them in or let them know why they can't be checked in.
kioskRoutes.get("/students/:id", async (c) => {
  const parsed = checkDateParam(c);
  if (parsed.error) return c.json({ error: "Forbidden" }, 403);

  const id = c.req.param("id") ?? "";
  const status = await getStudentStatusById(id, parsed.date);
  if (!status) return c.json({ error: "Not found" }, 404);
  return c.json(status);
});
