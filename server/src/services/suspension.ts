import { createRecords, getRecordOrNull, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields, SuspensionFields } from "../airtable/fields.js";
import { NotFoundError } from "../lib/errors.js";
import { today } from "../lib/date.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

// The member's unlifted Suspensions, read by id off their own inverse link.
async function activeSuspensionIds(member: MemberFields): Promise<string[]> {
  const suspensions = await Promise.all(
    (member.Suspensions ?? []).map((id) => getRecordOrNull<SuspensionFields>(TABLES.suspensions, id))
  );
  return suspensions.filter((s) => s && !s.fields["Lifted On"]).map((s) => s!.id);
}

// Suspending creates a Suspension already linked to this member, prefilled with their
// name so match-suspensions.js also catches any other Member record this person
// turns up under. Unsuspending lifts every unlifted Suspension
// linked to them (Lifted By/On), keeping the rows as history. Each is a no-op when
// the member is already in the requested state.
export async function setSuspended(id: string, suspended: boolean, userRoleId: string): Promise<StudentStatus> {
  const member = await getRecordOrNull<MemberFields>(TABLES.members, id);
  if (!member) throw new NotFoundError("Student not found");
  const f = member.fields;
  const isSuspended = (f["Is Suspended"] ?? 0) > 0;

  if (suspended && !isSuspended) {
    await createRecords<SuspensionFields>(TABLES.suspensions, [
      {
        "First Name": f["First Name"] ?? "",
        "Last Name": f["Last Name"] ?? "",
        Member: [id],
        "Suspended By": [userRoleId],
        "Suspended On": today(),
      },
    ]);
  } else if (!suspended && isSuspended) {
    for (const suspensionId of await activeSuspensionIds(f)) {
      await updateRecord<SuspensionFields>(TABLES.suspensions, suspensionId, {
        "Lifted By": [userRoleId],
        "Lifted On": today(),
      });
    }
  }

  const updated = await getStudentStatusById(id);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
