import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { students } from "../db/schema.js";
import { normalizeEmail } from "./date.js";

export async function findStudentIdByEmail(rawEmail: string): Promise<number | undefined> {
  const email = normalizeEmail(rawEmail);
  const [student] = await db.select().from(students).where(eq(students.email, email));
  return student?.id;
}
