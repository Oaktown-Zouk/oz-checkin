import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { checkins, payments, promoCredits } from "../db/schema.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { dateStringFor } from "../lib/date.js";
import { broadcastChange } from "../lib/events.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

type CreditPick = { kind: "payment"; id: number } | { kind: "promo"; id: number };

// Auto-selection only — the explicit `paymentId` param stays payments-only (a specific
// choice among several purchased passes only ever makes sense for real payments; there's
// at most one promo credit per student, so it never needs picking by id). Both lists are
// pre-sorted oldest-first, so spending the promo credit ahead of a paid one (when it's
// older) is the right default — it burns the freebie before eating into what they paid for.
function pickOldestUnredeemedCredit(status: StudentStatus): CreditPick | null {
  const paymentCandidate = status.credits?.payments.find((p) => !p.redeemed);
  const promoCandidate = status.credits?.promo.find((c) => !c.redeemed);
  if (!paymentCandidate) return promoCandidate ? { kind: "promo", id: promoCandidate.id } : null;
  if (!promoCandidate) return { kind: "payment", id: paymentCandidate.id };
  return new Date(paymentCandidate.paidAt).getTime() <= new Date(promoCandidate.grantedAt).getTime()
    ? { kind: "payment", id: paymentCandidate.id }
    : { kind: "promo", id: promoCandidate.id };
}

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
  let promoCreditIdToRedeem: number | null = null;

  if (opts.paymentId !== undefined) {
    const credit = status.credits?.payments.find((p) => p.id === opts.paymentId);
    if (!credit) throw new ConflictError("That payment doesn't belong to this student.");
    if (credit.redeemed) throw new ConflictError("That payment has already been redeemed.");
    paymentIdToRedeem = opts.paymentId;
  } else if (status.checkedInToday) {
    // Additional check-in beyond the first for this day always spends a credit.
    const pick = pickOldestUnredeemedCredit(status);
    if (!pick) {
      throw new ConflictError("No unredeemed credits available to use another pass.");
    }
    if (pick.kind === "payment") paymentIdToRedeem = pick.id;
    else promoCreditIdToRedeem = pick.id;
  } else if (!status.membership?.coversCheckIn) {
    // First check-in of the day, no membership covering it (none at all, or paused/etc.
    // without a payment in the last 30 days): auto-spend oldest credit if any (a real
    // payment or a promo credit like the new-student free drop-in).
    const pick = pickOldestUnredeemedCredit(status);
    if (pick) {
      if (pick.kind === "payment") paymentIdToRedeem = pick.id;
      else promoCreditIdToRedeem = pick.id;
    }
    // else: no covering membership, no credits — front-desk override, checked in with
    // no payment link.
  }
  // else: membership covers the first check-in of the day; nothing consumed.

  db.transaction((tx) => {
    const inserted = tx
      .insert(checkins)
      .values({
        studentId,
        date,
        checkedInAt: effectiveAt,
        checkedInBy: opts.checkedInBy ?? null,
        paymentId: paymentIdToRedeem,
        promoCreditId: promoCreditIdToRedeem,
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

    if (promoCreditIdToRedeem !== null) {
      tx
        .update(promoCredits)
        .set({ redeemedAt: effectiveAt, redeemedByCheckinId: inserted.id })
        .where(eq(promoCredits.id, promoCreditIdToRedeem))
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

    if (checkin.promoCreditId !== null) {
      tx
        .update(promoCredits)
        .set({ redeemedAt: null, redeemedByCheckinId: null })
        .where(eq(promoCredits.id, checkin.promoCreditId))
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
