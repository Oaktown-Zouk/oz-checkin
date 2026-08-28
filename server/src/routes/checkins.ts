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
  const { studentId, selections, effectiveAt, method } = body as {
    studentId?: string;
    selections?: unknown;
    effectiveAt?: string;
    method?: string;
  };

  if (!studentId || !isValidSelections(selections)) {
    return c.json({ error: "studentId and at least one { programId, role } selection are required" }, 400);
  }

  let effectiveDate: Date | undefined;
  if (effectiveAt !== undefined) {
    effectiveDate = new Date(effectiveAt);
    if (Number.isNaN(effectiveDate.getTime())) return c.json({ error: "Invalid effectiveAt" }, 400);
  }

  // Which UI created this — "Form"/"Backfill" are set by other means entirely (a
  // Givebutter form submission, a manual historical import) and are never valid here.
  // Just a record-keeping field, not a permission check, so an unrecognized value
  // simply falls back to "Staff" rather than 400ing the whole request over it.
  const checkinMethod = method === "Kiosk" ? "Kiosk" : "Staff";

  try {
    return c.json(await createCheckIns(studentId, selections, { effectiveAt: effectiveDate, method: checkinMethod }));
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
