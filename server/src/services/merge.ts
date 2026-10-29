import { getRecordOrNull, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields } from "../airtable/fields.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";

// Points a merged-away Member at the Member it was merged into, per SPEC.md's
// "Merging duplicate students". Setting Duplicate Of is the whole job here: the
// Airtable automation docs/airtable-automations/merge-duplicate-member.js triggers
// on it and moves check-ins, transactions, levels, etc. onto the survivor — the same
// path a Duplicate Of filled by detect-givebutter-merges.js or by hand takes.
//
// Only a Member whose Givebutter contact is gone (Removed From Givebutter) can be
// marked: merging in Givebutter's UI first keeps Givebutter and this base agreeing
// on who the one real person is.
export async function markDuplicateOf(duplicateId: string, survivorId: string): Promise<void> {
  if (survivorId === duplicateId) {
    throw new ConflictError("Can't mark a student as a duplicate of themselves.");
  }

  const [duplicate, survivor] = await Promise.all([
    getRecordOrNull<MemberFields>(TABLES.members, duplicateId),
    getRecordOrNull<MemberFields>(TABLES.members, survivorId),
  ]);
  if (!duplicate) throw new NotFoundError("Duplicate student not found");
  if (!survivor) throw new NotFoundError("Surviving student not found");

  if (!duplicate.fields["Removed From Givebutter"]) {
    throw new ConflictError("Merge this contact in Givebutter first; it can be marked once the nightly check sees it's gone.");
  }
  if (duplicate.fields["Duplicate Of"]?.length) {
    throw new ConflictError("This student is already marked as a duplicate.");
  }
  if (survivor.fields.Duplicate || survivor.fields["Duplicate Of"]?.length || survivor.fields["Removed From Givebutter"]) {
    throw new ConflictError("Pick the record Givebutter kept, not another merged-away one.");
  }

  await updateRecord<MemberFields>(TABLES.members, duplicateId, { "Duplicate Of": [survivorId] });
}
