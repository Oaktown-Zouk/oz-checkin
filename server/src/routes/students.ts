import { Hono, type Context } from "hono";
import { requirePermission } from "../lib/auth.js";
import { listStudentStatuses } from "../services/studentStatus.js";
import { updateStudentLevel } from "../services/levelups.js";
import { getStudentTimeline } from "../services/studentTimeline.js";
import { transferMembership, heldMemberships } from "../services/transfers.js";
import { mergeMembers } from "../services/merge.js";
import { createNote, updateNote } from "../services/notes.js";
import { isValidDateString } from "../lib/date.js";
import { handleError } from "../lib/respond.js";

export const studentRoutes = new Hono();

studentRoutes.get("/", requirePermission("View Student Data"), async (c) => {
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
    // Guarded by requirePermission("Write Student Data") below — a "Student" session
    // (the only role without userRoleId) never has that permission, so this is safe.
    return c.json(await updateStudentLevel(id, field, body.level, c.get("user").userRoleId!));
  } catch (err) {
    return handleError(c, err);
  }
}

studentRoutes.patch("/:id/lead-level", requirePermission("Write Student Data"), (c) =>
  handleLevelUpdate(c, "Lead Level")
);
studentRoutes.patch("/:id/follow-level", requirePermission("Write Student Data"), (c) =>
  handleLevelUpdate(c, "Follow Level")
);

studentRoutes.get("/:id/timeline", requirePermission("View Student Data"), async (c) => {
  const id = c.req.param("id") ?? "";
  const timeline = await getStudentTimeline(id);
  if (!timeline) return c.json({ error: "Student not found" }, 404);
  return c.json(timeline);
});

studentRoutes.get("/:id/memberships", requirePermission("View Student Data"), async (c) => {
  const id = c.req.param("id") ?? "";
  return c.json(await heldMemberships(id));
});

studentRoutes.post("/:id/transfer-membership", requirePermission("Write Memberships"), async (c) => {
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

// Not nested under a single :id — after the caller picks a survivor in the dialog
// (see web/src/components/MergeDialog.tsx), either of the two picked students could
// end up on either side, so both ids are just body fields.
studentRoutes.post("/merge", requirePermission("Write Memberships"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { survivorId, duplicateId } = body as { survivorId?: string; duplicateId?: string };
  if (!survivorId || !duplicateId) {
    return c.json({ error: "survivorId and duplicateId are required" }, 400);
  }
  try {
    return c.json(await mergeMembers(survivorId, duplicateId));
  } catch (err) {
    return handleError(c, err);
  }
});

studentRoutes.post("/:id/notes", requirePermission("Write Student Data"), async (c) => {
  const id = c.req.param("id") ?? "";
  const body = await c.req.json().catch(() => ({}));
  const { summary, strengths, opportunities } = body as {
    summary?: string;
    strengths?: string;
    opportunities?: string;
  };
  if (!summary?.trim()) return c.json({ error: "summary is required" }, 400);
  try {
    // Guarded by requirePermission("Write Student Data") above — a "Student" session
    // (the only role without userRoleId) never has that permission, so this is safe.
    await createNote(
      id,
      { summary: summary.trim(), strengths: strengths?.trim() ?? "", opportunities: opportunities?.trim() ?? "" },
      c.get("user").userRoleId!
    );
    return c.json({ ok: true });
  } catch (err) {
    return handleError(c, err);
  }
});

studentRoutes.patch("/:id/notes/:noteId", requirePermission("Write Student Data"), async (c) => {
  const noteId = c.req.param("noteId") ?? "";
  const body = await c.req.json().catch(() => ({}));
  const { summary, strengths, opportunities } = body as {
    summary?: string;
    strengths?: string;
    opportunities?: string;
  };
  if (!summary?.trim()) return c.json({ error: "summary is required" }, 400);
  try {
    // Guarded by requirePermission("Write Student Data") above — a "Student" session
    // (the only role without userRoleId) never has that permission, so this is safe.
    // updateNote itself rejects editing another issuer's note (403).
    await updateNote(
      noteId,
      { summary: summary.trim(), strengths: strengths?.trim() ?? "", opportunities: opportunities?.trim() ?? "" },
      c.get("user").userRoleId!
    );
    return c.json({ ok: true });
  } catch (err) {
    return handleError(c, err);
  }
});
