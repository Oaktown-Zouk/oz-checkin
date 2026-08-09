import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { checkins, payments } from "../db/schema.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { dateStringFor } from "../lib/date.js";
import { broadcastChange } from "../lib/events.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

export async function createCheckIn(
  studentId: number,
  opts: { paymentId?: number; checkedInBy?: string; effectiveAt?: Date } = {}
): Promise<StudentStatus> {
  // Front desk can backdate a correction via effectiveAt — both the day-bucket and the
  // exact timestamp follow it, so "already checked in" / credit-cap logic below is
  // evaluated against that day, not whatever day it actually is right now.
  const effectiveAt = opts.effectiveAt ?? new Date();
  const date = dateStringFor(effectiveAt);

  const status = await getStudentStatusById(studentId, date);
  if (!status) throw new NotFoundError("Student not found");

  if (status.checkedInToday && !status.canCheckIn) {
    throw new ConflictError(
      `Already checked in on ${date} and no unredeemed credits remain to use another pass.`
    );
  }

  let paymentIdToRedeem: number | null = null;

  if (opts.paymentId !== undefined) {
    const credit = status.credits?.payments.find((p) => p.id === opts.paymentId);
    if (!credit) throw new ConflictError("That payment doesn't belong to this student.");
    if (credit.redeemed) throw new ConflictError("That payment has already been redeemed.");
    paymentIdToRedeem = opts.paymentId;
  } else if (status.checkedInToday) {
    // Additional check-in beyond the first for this day always spends a credit.
    const oldestUnredeemed = status.credits?.payments.find((p) => !p.redeemed);
    if (!oldestUnredeemed) {
      throw new ConflictError("No unredeemed credits available to use another pass.");
    }
    paymentIdToRedeem = oldestUnredeemed.id;
  } else if (!status.membership?.active) {
    // First check-in of the day, no active membership: auto-spend oldest credit if any.
    const oldestUnredeemed = status.credits?.payments.find((p) => !p.redeemed);
    if (oldestUnredeemed) paymentIdToRedeem = oldestUnredeemed.id;
    // else: no membership, no credits — front-desk override, checked in with no payment link.
  }
  // else: active membership covers the first check-in of the day; nothing consumed.

  db.transaction((tx) => {
    const inserted = tx
      .insert(checkins)
      .values({
        studentId,
        date,
        checkedInAt: effectiveAt,
        checkedInBy: opts.checkedInBy ?? null,
        paymentId: paymentIdToRedeem,
      })
      .returning()
      .get();

    if (paymentIdToRedeem !== null) {
      tx
        .update(payments)
        .set({ redeemedAt: effectiveAt, redeemedByCheckinId: inserted.id })
        .where(eq(payments.id, paymentIdToRedeem))
        .run();
    }
  });

  const updated = await getStudentStatusById(studentId, date);
  if (!updated) throw new NotFoundError("Student not found");
  broadcastChange("checkin");
  return updated;
}

export async function undoCheckIn(checkinId: number): Promise<StudentStatus> {
  const [checkin] = await db
    .select()
    .from(checkins)
    .where(and(eq(checkins.id, checkinId), isNull(checkins.undoneAt)));

  if (!checkin) throw new NotFoundError("Check-in not found (or already undone)");

  db.transaction((tx) => {
    tx.update(checkins).set({ undoneAt: new Date() }).where(eq(checkins.id, checkinId)).run();

    if (checkin.paymentId !== null) {
      tx
        .update(payments)
        .set({ redeemedAt: null, redeemedByCheckinId: null })
        .where(eq(payments.id, checkin.paymentId))
        .run();
    }
  });

  // Return status for the day the check-in belonged to, not literally today — undoing a
  // backdated correction should reflect back on that day's view, not "today"'s.
  const updated = await getStudentStatusById(checkin.studentId, checkin.date);
  if (!updated) throw new NotFoundError("Student not found");
  broadcastChange("undo");
  return updated;
}
