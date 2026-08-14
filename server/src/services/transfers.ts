import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memberships, payments, membershipCharges } from "../db/schema.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { findStudentIdByEmail } from "../lib/upsertStudent.js";
import { normalizeEmail } from "../lib/date.js";
import { broadcastChange } from "../lib/events.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

export type TransferKind = "membership" | "payment";

// Moves a membership or unredeemed one-time credit from whoever currently holds it to a
// different student, e.g. "Alice bought two memberships, one was actually for Bob."
// Only holderStudentId changes — studentId (the raw Givebutter payer) is untouched, so
// "who actually paid" is preserved for display even after the transfer (see
// services/studentStatus.ts's managedByName/purchasedByName/paidMembershipsForOthers).
export async function transferItem(
  sourceStudentId: number,
  kind: TransferKind,
  itemId: number,
  targetEmailRaw: string
): Promise<StudentStatus> {
  const targetEmail = normalizeEmail(targetEmailRaw);
  const targetStudentId = await findStudentIdByEmail(targetEmail);
  if (!targetStudentId) throw new NotFoundError(`No student found with email ${targetEmailRaw}`);

  if (kind === "membership") {
    const [membership] = await db.select().from(memberships).where(eq(memberships.id, itemId));
    if (!membership) throw new NotFoundError("Membership not found");

    const currentHolderId = membership.holderStudentId ?? membership.studentId;
    if (currentHolderId !== sourceStudentId) {
      throw new ConflictError("That membership doesn't belong to this student. Refresh and try again.");
    }
    if (targetStudentId === currentHolderId) {
      throw new ConflictError("That membership already belongs to this student.");
    }

    db.transaction((tx) => {
      tx.update(memberships)
        .set({ holderStudentId: targetStudentId, updatedAt: new Date() })
        .where(eq(memberships.id, itemId))
        .run();
      // Immediate consistency for existing charge history — sync keeps future charges
      // in sync too (see services/givebutter.ts), but front desk shouldn't have to wait
      // up to SYNC_INTERVAL_MINUTES to see this transfer reflected.
      tx.update(membershipCharges)
        .set({ holderStudentId: targetStudentId, updatedAt: new Date() })
        .where(eq(membershipCharges.givebutterPlanId, membership.givebutterPlanId))
        .run();
    });
  } else {
    const [payment] = await db.select().from(payments).where(eq(payments.id, itemId));
    if (!payment) throw new NotFoundError("Credit not found");

    const currentHolderId = payment.holderStudentId ?? payment.studentId;
    if (currentHolderId !== sourceStudentId) {
      throw new ConflictError("That credit doesn't belong to this student. Refresh and try again.");
    }
    if (targetStudentId === currentHolderId) {
      throw new ConflictError("That credit already belongs to this student.");
    }
    if (payment.redeemedAt !== null) {
      throw new ConflictError("That credit has already been redeemed and can't be transferred.");
    }

    await db
      .update(payments)
      .set({ holderStudentId: targetStudentId, updatedAt: new Date() })
      .where(eq(payments.id, itemId));
  }

  const updated = await getStudentStatusById(sourceStudentId);
  if (!updated) throw new NotFoundError("Student not found");
  broadcastChange("transfer");
  return updated;
}
