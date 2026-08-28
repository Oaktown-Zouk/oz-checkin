import { getRecordOrNull, createRecords, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields, NoteFields } from "../airtable/fields.js";
import { NotFoundError, ForbiddenError } from "../lib/errors.js";

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

// Only the note's own author can edit it — other staff can read every note on a
// student's timeline, but editing someone else's write-up isn't allowed (matches how
// Levelups attributes "by <issuer>" without letting a different staffer alter that
// record after the fact).
export async function updateNote(
  noteId: string,
  note: { summary: string; strengths: string; opportunities: string },
  issuerRoleId: string
): Promise<void> {
  const existing = await getRecordOrNull<NoteFields>(TABLES.notes, noteId);
  if (!existing) throw new NotFoundError("Note not found");
  if (existing.fields.Issuer?.[0] !== issuerRoleId) {
    throw new ForbiddenError("You can only edit your own notes");
  }
  await updateRecord<NoteFields>(TABLES.notes, noteId, {
    Summary: note.summary,
    Strengths: note.strengths,
    Opportunities: note.opportunities,
  });
}
