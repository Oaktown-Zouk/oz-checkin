import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { students, studentEmails } from "../db/schema.js";
import { normalizeEmail } from "./date.js";

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

export async function upsertStudent(rawEmail: string, rawName: string): Promise<number> {
  const email = normalizeEmail(rawEmail);
  // Real waiver data has trailing whitespace on names (seen live from the OZ form),
  // so this is a real case, not defensive-for-its-own-sake.
  const name = rawName.trim();

  const existingId = await findStudentIdByEmail(email);
  if (existingId) {
    const [existing] = await db.select().from(students).where(eq(students.id, existingId));
    if (name && existing && name !== existing.name) {
      await db
        .update(students)
        .set({ name, updatedAt: new Date() })
        .where(eq(students.id, existingId));
    }
    return existingId;
  }

  const [created] = await db
    .insert(students)
    .values({ email, name: name || email })
    .returning();
  return created.id;
}
