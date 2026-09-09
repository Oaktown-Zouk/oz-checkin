import { getRecordOrNull, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields } from "../airtable/fields.js";
import { NotFoundError } from "../lib/errors.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

// Split out from studentStatus.ts (which stays read-only) for the same reason as
// levelups.ts/notes.ts — see levelups.ts's comment.
export async function updatePreferredName(id: string, preferredName: string): Promise<StudentStatus> {
  if (!(await getRecordOrNull<MemberFields>(TABLES.members, id))) throw new NotFoundError("Student not found");

  await updateRecord<MemberFields>(TABLES.members, id, { "Preferred Name": preferredName });

  const updated = await getStudentStatusById(id);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
