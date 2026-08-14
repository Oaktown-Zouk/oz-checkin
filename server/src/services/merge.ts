import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  checkins,
  givebutterContacts,
  memberships,
  membershipCharges,
  payments,
  promoCredits,
  students,
  studentEmails,
  waivers,
} from "../db/schema.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { findStudentIdByEmail, shouldUpdateName, type NameSource } from "../lib/upsertStudent.js";
import { normalizeEmail } from "../lib/date.js";
import { broadcastChange } from "../lib/events.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

async function hasWaiver(studentId: number): Promise<boolean> {
  const rows = await db
    .select({ id: waivers.id })
    .from(waivers)
    .where(eq(waivers.studentId, studentId))
    .limit(1);
  return rows.length > 0;
}

async function hasGivebutterRecord(studentId: number): Promise<boolean> {
  // Belt-and-suspenders across all three Givebutter-sourced tables, in case a student
  // predates givebutter_contacts being populated (see services/givebutter.ts). Payments
  // and memberships are checked by holderStudentId, not studentId — a transferred item
  // means this student now genuinely holds Givebutter-linked data of their own,
  // regardless of who originally paid for it.
  const [contact, payment, membership] = await Promise.all([
    db.select({ id: givebutterContacts.id }).from(givebutterContacts).where(eq(givebutterContacts.studentId, studentId)).limit(1),
    db.select({ id: payments.id }).from(payments).where(eq(payments.holderStudentId, studentId)).limit(1),
    db.select({ id: memberships.id }).from(memberships).where(eq(memberships.holderStudentId, studentId)).limit(1),
  ]);
  return contact.length > 0 || payment.length > 0 || membership.length > 0;
}

// Merges the student found by `otherEmail` into `survivorId`: reassigns all of the
// absorbed student's child records (waivers, Givebutter contact/payments/memberships/
// membership charges, check-ins, promo credits) to the survivor, links the absorbed
// email(s) so future syncs recognize them as the survivor, and deletes the absorbed
// student row.
//
// Guardrail (per product decision): the only legitimate use today is combining a
// Google-Forms-only student with a Givebutter-only student — i.e. exactly one side has
// waiver data and the other has Givebutter data. Merging two students that both already
// have a waiver, or both already have Givebutter data, is blocked; that's a sign the
// "other email" doesn't actually belong to the same source-gap this feature exists to
// fix, and blindly merging would silently destroy one side's real duplicate history.
export async function mergeStudents(survivorId: number, otherEmailRaw: string): Promise<StudentStatus> {
  const survivor = await getStudentStatusById(survivorId);
  if (!survivor) throw new NotFoundError("Student not found");

  const otherEmail = normalizeEmail(otherEmailRaw);
  const otherId = await findStudentIdByEmail(otherEmail);
  if (!otherId) throw new NotFoundError(`No student found with email ${otherEmailRaw}`);
  if (otherId === survivorId) throw new ConflictError("That email already belongs to this student.");

  const [survivorHasWaiver, survivorHasGivebutter, otherHasWaiver, otherHasGivebutter] = await Promise.all([
    hasWaiver(survivorId),
    hasGivebutterRecord(survivorId),
    hasWaiver(otherId),
    hasGivebutterRecord(otherId),
  ]);

  if (survivorHasGivebutter && otherHasGivebutter) {
    throw new ConflictError(
      "Both students already have Givebutter records on file — merging would combine two separate Givebutter identities, not fill a gap. If these really are the same person, this needs a manual DB fix, not a menu merge."
    );
  }
  if (survivorHasWaiver && otherHasWaiver) {
    throw new ConflictError(
      "Both students already have Google Forms waiver records on file — merging would combine two separate waiver submissions, not fill a gap. If these really are the same person, this needs a manual DB fix, not a menu merge."
    );
  }

  const [survivorRow] = await db.select().from(students).where(eq(students.id, survivorId));
  const [otherStudent] = await db.select().from(students).where(eq(students.id, otherId));
  if (!survivorRow || !otherStudent) throw new NotFoundError("Student not found");

  // Givebutter names are checked against a real credit card by a payment processor;
  // Google Forms names are free text. Merging shouldn't be able to downgrade a
  // payment-verified name any more than a routine sync can — same rule, reused.
  const adoptOtherName =
    otherStudent.nameSource !== null &&
    otherStudent.name !== survivorRow.name &&
    shouldUpdateName(survivorRow.nameSource, otherStudent.nameSource as NameSource);

  // Promo credits are one-per-reason per student (see schema.ts) — if the survivor
  // already has a grant for some reason (e.g. "new_student", which nearly every real
  // student row has independently), the absorbed student's matching row can't be
  // reassigned without violating that constraint. Merging exists to fix one real person
  // being represented twice, not to double up a one-per-student freebie, so that
  // duplicate is dropped rather than kept under a fudged reason.
  const [survivorPromoCredits, otherPromoCredits] = await Promise.all([
    db.select().from(promoCredits).where(eq(promoCredits.studentId, survivorId)),
    db.select().from(promoCredits).where(eq(promoCredits.studentId, otherId)),
  ]);
  const survivorPromoReasons = new Set(survivorPromoCredits.map((c) => c.reason));
  const otherPromoCreditIdsToReassign = otherPromoCredits
    .filter((c) => !survivorPromoReasons.has(c.reason))
    .map((c) => c.id);
  const otherPromoCreditIdsToDrop = otherPromoCredits
    .filter((c) => survivorPromoReasons.has(c.reason))
    .map((c) => c.id);

  db.transaction((tx) => {
    if (adoptOtherName) {
      tx
        .update(students)
        .set({ name: otherStudent.name, nameSource: otherStudent.nameSource, updatedAt: new Date() })
        .where(eq(students.id, survivorId))
        .run();
    }

    tx.update(waivers).set({ studentId: survivorId }).where(eq(waivers.studentId, otherId)).run();
    tx.update(givebutterContacts).set({ studentId: survivorId }).where(eq(givebutterContacts.studentId, otherId)).run();
    tx.update(checkins).set({ studentId: survivorId }).where(eq(checkins.studentId, otherId)).run();

    // A merge means "these are the same real person," so studentId (payer) and
    // holderStudentId (current holder) both move to the survivor — but they're updated
    // independently since a transfer may have already made them diverge on the absorbed
    // student's rows (e.g. otherId paid for someone else's membership, or holds one
    // someone else paid for). Two separate updates per table correctly handle all four
    // combinations without one clobbering the other.
    for (const table of [payments, memberships, membershipCharges]) {
      tx.update(table).set({ studentId: survivorId }).where(eq(table.studentId, otherId)).run();
      tx.update(table)
        .set({ holderStudentId: survivorId })
        .where(eq(table.holderStudentId, otherId))
        .run();
    }

    if (otherPromoCreditIdsToReassign.length > 0) {
      tx.update(promoCredits)
        .set({ studentId: survivorId })
        .where(inArray(promoCredits.id, otherPromoCreditIdsToReassign))
        .run();
    }
    if (otherPromoCreditIdsToDrop.length > 0) {
      tx.delete(promoCredits).where(inArray(promoCredits.id, otherPromoCreditIdsToDrop)).run();
    }

    // Re-point any emails already linked to the absorbed student, then link its
    // primary email too — this is what makes the merge "stick" across future syncs.
    tx.update(studentEmails).set({ studentId: survivorId }).where(eq(studentEmails.studentId, otherId)).run();
    tx.insert(studentEmails)
      .values({ studentId: survivorId, email: otherStudent.email })
      .onConflictDoNothing()
      .run();

    tx.delete(students).where(eq(students.id, otherId)).run();
  });

  const updated = await getStudentStatusById(survivorId);
  if (!updated) throw new NotFoundError("Student not found");
  broadcastChange("merge");
  return updated;
}
