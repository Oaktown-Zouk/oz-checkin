import { getRecordOrNull, createRecords, TABLES } from "../airtable/client.js";
import type { MemberFields, NoteFields } from "../airtable/fields.js";
import { NotFoundError } from "../lib/errors.js";

// issuerRoleId is the signed-in account's own User Roles record id (see
// UserAccess.userRoleId, same pattern as Levelups.Issuer) — already resolved once at
// login, so attributing the note costs no extra Airtable lookup here.
export async function createNote(
  studentId: string,
  note: { summary: string; strengths: string; opportunities: string },
  issuerRoleId: string
): Promise<void> {
  if (!(await getRecordOrNull<MemberFields>(TABLES.members, studentId))) {
    throw new NotFoundError("Student not found");
  }
  await createRecords<NoteFields>(TABLES.notes, [
    {
      Member: [studentId],
      Issuer: [issuerRoleId],
      Summary: note.summary,
      Strengths: note.strengths,
      Opportunities: note.opportunities,
    },
  ]);
}
