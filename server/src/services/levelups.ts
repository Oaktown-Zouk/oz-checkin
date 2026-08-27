import { getRecordOrNull, updateRecord, createRecords, TABLES } from "../airtable/client.js";
import type { MemberFields, LevelupFields } from "../airtable/fields.js";
import { NotFoundError } from "../lib/errors.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

// Split out from studentStatus.ts (which stays read-only) specifically so the
// student app (server/src/studentApp.ts) can import that file's read-only exports
// (getStudentStatusById, fetchProgramNames, listStudentStatuses) without this
// write-capable function riding along in the same module — see SPEC.md's "Student
// self-service login" section.
//
// issuerRoleId is the signed-in account's own User Roles record id (see
// UserAccess.userRoleId) — already resolved once at login and carried in the session,
// so recording who made the change costs no extra Airtable lookup here.
export async function updateStudentLevel(
  id: string,
  field: "Lead Level" | "Follow Level",
  level: number | null,
  issuerRoleId: string
): Promise<StudentStatus> {
  const member = await getRecordOrNull<MemberFields>(TABLES.members, id);
  if (!member) throw new NotFoundError("Student not found");
  const previousLevel = member.fields[field] ?? null;

  await updateRecord<Record<"Lead Level" | "Follow Level", number | null>>(TABLES.members, id, {
    [field]: level,
  } as Record<"Lead Level" | "Follow Level", number | null>);

  // Only a real change is worth a Levelups row — re-saving the same level (e.g. a
  // duplicate/retried request) shouldn't log a no-op event.
  if (level !== previousLevel) {
    await createRecords<LevelupFields>(TABLES.levelups, [
      {
        Member: [id],
        Issuer: [issuerRoleId],
        Role: field === "Lead Level" ? "Lead" : "Follow",
        ...(previousLevel !== null ? { From: previousLevel } : {}),
        ...(level !== null ? { To: level } : {}),
      },
    ]);
  }

  const updated = await getStudentStatusById(id);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
