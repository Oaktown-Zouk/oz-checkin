import { Hono } from "hono";
import { requirePermission } from "../lib/auth.js";
import { createCheckIns, undoCheckIn, type CheckInSelection } from "../services/checkins.js";
import { handleError } from "../lib/respond.js";

export const checkinRoutes = new Hono();

function isValidSelections(value: unknown): value is CheckInSelection[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (s) =>
        s &&
        typeof s.programId === "string" &&
        s.programId.length > 0 &&
        (s.role === "Lead" || s.role === "Follow")
    )
  );
}

checkinRoutes.post("/", requirePermission("Create Checkins"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { studentId, selections, effectiveAt } = body as {
    studentId?: string;
    selections?: unknown;
    effectiveAt?: string;
  };

  if (!studentId || !isValidSelections(selections)) {
    return c.json({ error: "studentId and at least one { programId, role } selection are required" }, 400);
  }

  let effectiveDate: Date | undefined;
  if (effectiveAt !== undefined) {
    effectiveDate = new Date(effectiveAt);
    if (Number.isNaN(effectiveDate.getTime())) return c.json({ error: "Invalid effectiveAt" }, 400);
  }

  try {
    return c.json(await createCheckIns(studentId, selections, { effectiveAt: effectiveDate }));
  } catch (err) {
    return handleError(c, err);
  }
});

checkinRoutes.delete("/:id", requirePermission("Undo Checkins"), async (c) => {
  const id = c.req.param("id") ?? "";
  try {
    return c.json(await undoCheckIn(id));
  } catch (err) {
    return handleError(c, err);
  }
});
