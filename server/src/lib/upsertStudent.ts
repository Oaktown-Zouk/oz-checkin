import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { students, studentEmails, promoCredits } from "../db/schema.js";
import { normalizeEmail } from "./date.js";

// Policy: every new student gets one free drop-in credit, regardless of which sync
// (Forms or Givebutter) sees them first — granted once, below, at student creation.
const NEW_STUDENT_PROMO_REASON = "new_student";

export type NameSource = "google_forms" | "givebutter";

// Givebutter names are checked against a real credit card by a payment processor;
// Google Forms names are free text someone typed. Once a name has been set from
// Givebutter, a Forms sync must never downgrade it — this is the only ordering that
// matters, so it's expressed directly rather than as a general-purpose priority scale.
export function shouldUpdateName(existingSource: string | null, newSource: NameSource): boolean {
  return !(existingSource === "givebutter" && newSource === "google_forms");
}

// Resolves an email to a student, checking both the primary `students.email` and any
// alternate emails linked via a merge (see services/merge.ts). This is what makes a
// merge "stick" — once two duplicate students are merged, a future sync that sees the
// absorbed student's email recognizes it as already-known instead of recreating the
// duplicate.
export async function findStudentIdByEmail(rawEmail: string): Promise<number | undefined> {
  const email = normalizeEmail(rawEmail);

  const [primary] = await db.select().from(students).where(eq(students.email, email));
  if (primary) return primary.id;

  const [linked] = await db.select().from(studentEmails).where(eq(studentEmails.email, email));
  return linked?.studentId;
}

export async function upsertStudent(
  rawEmail: string,
  rawName: string,
  source: NameSource
): Promise<number> {
  const email = normalizeEmail(rawEmail);
  // Real waiver data has trailing whitespace on names (seen live from the OZ form),
  // so this is a real case, not defensive-for-its-own-sake.
  const name = rawName.trim();

  const existingId = await findStudentIdByEmail(email);
  if (existingId) {
    const [existing] = await db.select().from(students).where(eq(students.id, existingId));
    // Stamp the source even when the name text is unchanged: rows created before
    // name-source tracking existed (or backfilled by a migration) have a null
    // source, so this is what claims them as Givebutter-verified going forward
    // instead of leaving them permanently open to a later Forms downgrade.
    if (
      name &&
      existing &&
      (name !== existing.name || existing.nameSource !== source) &&
      shouldUpdateName(existing.nameSource, source)
    ) {
      await db
        .update(students)
        .set({ name, nameSource: source, updatedAt: new Date() })
        .where(eq(students.id, existingId));
    }
    return existingId;
  }

  const [created] = await db
    .insert(students)
    .values({ email, name: name || email, nameSource: name ? source : null })
    .returning();

  // onConflictDoNothing: defensive against the (rare) race where Forms and Givebutter
  // sync both see the same brand-new email in the same run — belt-and-suspenders, not
  // load-bearing, since the unique index on students.email means only one of those two
  // inserts can actually succeed.
  await db
    .insert(promoCredits)
    .values({ studentId: created.id, reason: NEW_STUDENT_PROMO_REASON, grantedAt: new Date() })
    .onConflictDoNothing();

  return created.id;
}
