import { Hono, type Context } from "hono";
import { requireAuth } from "../lib/auth.js";
import { listStudentStatuses, updateStudentLevel } from "../services/studentStatus.js";
import { getStudentTimeline } from "../services/studentTimeline.js";
import { transferMembership, heldMemberships } from "../services/transfers.js";
import { isValidDateString } from "../lib/date.js";
import { handleError } from "../lib/respond.js";

export const studentRoutes = new Hono();
studentRoutes.use("*", requireAuth);

studentRoutes.get("/", async (c) => {
  const date = c.req.query("date");
  if (date !== undefined && !isValidDateString(date)) {
    return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  }
  return c.json(await listStudentStatuses({ date }));
});

const VALID_LEVELS = [1, 2, 3, 4];

function isValidLevel(level: unknown): level is number | null {
  return level === null || (typeof level === "number" && VALID_LEVELS.includes(level));
}

async function handleLevelUpdate(c: Context, field: "Lead Level" | "Follow Level") {
  const id = c.req.param("id") ?? "";
  const body = await c.req.json().catch(() => ({}));
  if (!isValidLevel(body.level)) return c.json({ error: "level must be 1-4 or null" }, 400);
  try {
    return c.json(await updateStudentLevel(id, field, body.level));
  } catch (err) {
    return handleError(c, err);
  }
}

studentRoutes.patch("/:id/lead-level", (c) => handleLevelUpdate(c, "Lead Level"));
studentRoutes.patch("/:id/follow-level", (c) => handleLevelUpdate(c, "Follow Level"));

studentRoutes.get("/:id/timeline", async (c) => {
  const id = c.req.param("id") ?? "";
  const timeline = await getStudentTimeline(id);
  if (!timeline) return c.json({ error: "Student not found" }, 404);
  return c.json(timeline);
});

studentRoutes.get("/:id/memberships", async (c) => {
  const id = c.req.param("id") ?? "";
  return c.json(await heldMemberships(id));
});

studentRoutes.post("/:id/transfer-membership", async (c) => {
  const id = c.req.param("id") ?? "";
  const body = await c.req.json().catch(() => ({}));
  const { planId, targetEmail } = body as { planId?: string; targetEmail?: string };
  if (!planId || !targetEmail?.trim()) {
    return c.json({ error: "planId and targetEmail are required" }, 400);
  }
  try {
    return c.json(await transferMembership(id, planId, targetEmail));
  } catch (err) {
    return handleError(c, err);
  }
});
