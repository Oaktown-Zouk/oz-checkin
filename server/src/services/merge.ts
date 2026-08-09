import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  checkins,
  givebutterContacts,
  memberships,
  payments,
  students,
  studentEmails,
  waivers,
} from "../db/schema.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { findStudentIdByEmail } from "../lib/upsertStudent.js";
import { normalizeEmail } from "../lib/date.js";
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
  // predates givebutter_contacts being populated (see services/givebutter.ts).
  const [contact, payment, membership] = await Promise.all([
    db.select({ id: givebutterContacts.id }).from(givebutterContacts).where(eq(givebutterContacts.studentId, studentId)).limit(1),
    db.select({ id: payments.id }).from(payments).where(eq(payments.studentId, studentId)).limit(1),
    db.select({ id: memberships.id }).from(memberships).where(eq(memberships.studentId, studentId)).limit(1),
  ]);
  return contact.length > 0 || payment.length > 0 || membership.length > 0;
}

// Merges the student found by `otherEmail` into `survivorId`: reassigns all of the
// absorbed student's child records (waivers, Givebutter contact/payments/memberships,
// check-ins) to the survivor, links the absorbed email(s) so future syncs recognize them
// as the survivor, and deletes the absorbed student row.
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

  const [otherStudent] = await db.select().from(students).where(eq(students.id, otherId));
  if (!otherStudent) throw new NotFoundError("Student not found");

  db.transaction((tx) => {
    tx.update(waivers).set({ studentId: survivorId }).where(eq(waivers.studentId, otherId)).run();
    tx.update(givebutterContacts).set({ studentId: survivorId }).where(eq(givebutterContacts.studentId, otherId)).run();
    tx.update(payments).set({ studentId: survivorId }).where(eq(payments.studentId, otherId)).run();
    tx.update(memberships).set({ studentId: survivorId }).where(eq(memberships.studentId, otherId)).run();
    tx.update(checkins).set({ studentId: survivorId }).where(eq(checkins.studentId, otherId)).run();

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
  return updated;
}
