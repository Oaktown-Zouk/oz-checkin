import { listRecords, getRecordOrNull, updateRecord, TABLES, type AirtableRecord } from "../airtable/client.js";
import type { MemberFields } from "../airtable/fields.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

// Repoints every already-fetched row whose `field` link includes `fromId` to point at
// `toId` instead — the actual "merge" mechanic. Most of a Member's stats (Classes
// Allowed, Available Credits, Remaining Today, Recently Active, ...) are Airtable
// rollups/formulas computed over these linked tables, so once the links move, those
// numbers recompute themselves; nothing here does that arithmetic by hand. This is
// also why merging duplicate credits needs no special handling any more: Checkins,
// Transactions, and Comp Credits are all in this same repointLinks pass, so
// Members.Credits Consumed/Credits Purchased/Comp Credits (all rollups) just follow
// automatically once those links move. Each update is independent and idempotent —
// re-pointing an already-correct link is a no-op — so a partial failure is always
// safe to just retry.
async function repointLinks(
  table: string,
  records: AirtableRecord<{ [key: string]: unknown }>[],
  field: string,
  fromId: string,
  toId: string
): Promise<void> {
  const matches = records.filter((r) => (r.fields[field] as string[] | undefined)?.includes(fromId));
  await Promise.all(matches.map((r) => updateRecord(table, r.id, { [field]: [toId] })));
}

// Never overwrites a value the survivor already has — the survivor's own identity
// (name, email) and any data it already carries is always authoritative. Only fills
// in something the survivor is missing but the absorbed duplicate happened to have,
// so real data (an assessed level, a phone number) recorded under the wrong row isn't
// silently lost. "New Member Credit" belongs here rather than needing its own
// reassignment pass for the same reason: it defaults to 1 on every Member row, so the
// common case (survivor already has its own) is a no-op — the duplicate's is simply
// dropped when the duplicate is hidden, never summed, so a race that created two
// Member rows for one signup (see docs/airtable-automations/README.md) still can't
// double-count the signup bonus after a merge.
async function fillMemberGaps(survivorId: string, duplicateFields: MemberFields): Promise<void> {
  const survivor = await getRecordOrNull<MemberFields>(TABLES.members, survivorId);
  if (!survivor) return;

  const updates: Partial<MemberFields> = {};
  if (!survivor.fields.Phone && duplicateFields.Phone) updates.Phone = duplicateFields.Phone;
  if (survivor.fields["Lead Level"] == null && duplicateFields["Lead Level"] != null) {
    updates["Lead Level"] = duplicateFields["Lead Level"];
  }
  if (survivor.fields["Follow Level"] == null && duplicateFields["Follow Level"] != null) {
    updates["Follow Level"] = duplicateFields["Follow Level"];
  }
  if (!survivor.fields["Contact ID"] && duplicateFields["Contact ID"]) {
    updates["Contact ID"] = duplicateFields["Contact ID"];
  }
  if (survivor.fields["New Member Credit"] == null && duplicateFields["New Member Credit"] != null) {
    updates["New Member Credit"] = duplicateFields["New Member Credit"];
  }
  if (Object.keys(updates).length > 0) {
    await updateRecord<MemberFields>(TABLES.members, survivorId, updates);
  }
}

// Combines two Member rows that represent the same real person (e.g. a Givebutter
// sync creating a second row for a case-variant email) into one, per SPEC.md's
// "Merging duplicate students" section. `survivorId` is the caller's explicit choice
// (see web/src/components/MergeDialog.tsx) — this function doesn't guess which side
// should win.
export async function mergeMembers(survivorId: string, duplicateId: string): Promise<StudentStatus> {
  if (survivorId === duplicateId) {
    throw new ConflictError("Can't merge a student into themselves.");
  }

  const [survivor, duplicate] = await Promise.all([
    getRecordOrNull<MemberFields>(TABLES.members, survivorId),
    getRecordOrNull<MemberFields>(TABLES.members, duplicateId),
  ]);
  if (!survivor) throw new NotFoundError("Survivor student not found");
  if (!duplicate) throw new NotFoundError("Duplicate student not found");

  const [checkins, recurringPlans, transactions, levelups, notes, compCredits] = await Promise.all([
    listRecords(TABLES.checkins, { fields: ["Member"] }),
    listRecords(TABLES.recurringPlans, { fields: ["Member", "Covers Member"] }),
    listRecords(TABLES.transactions, { fields: ["Member"] }),
    listRecords(TABLES.levelups, { fields: ["Member"] }),
    listRecords(TABLES.notes, { fields: ["Member"] }),
    listRecords(TABLES.compCredits, { fields: ["Member"] }),
  ]);

  await Promise.all([
    repointLinks(TABLES.checkins, checkins, "Member", duplicateId, survivorId),
    // Member (payer) and Covers Member (holder) reassign independently — a plan may
    // already have the duplicate as payer for someone else's coverage, or vice versa
    // (see transferMembership, which relies on this same split) — so both need their
    // own pass rather than assuming they always match on a given row.
    repointLinks(TABLES.recurringPlans, recurringPlans, "Member", duplicateId, survivorId),
    repointLinks(TABLES.recurringPlans, recurringPlans, "Covers Member", duplicateId, survivorId),
    repointLinks(TABLES.transactions, transactions, "Member", duplicateId, survivorId),
    repointLinks(TABLES.compCredits, compCredits, "Member", duplicateId, survivorId),
    repointLinks(TABLES.levelups, levelups, "Member", duplicateId, survivorId),
    repointLinks(TABLES.notes, notes, "Member", duplicateId, survivorId),
  ]);

  await fillMemberGaps(survivorId, duplicate.fields);

  // Flagged last, only once every reassignment above has actually landed — if
  // anything failed partway through, the duplicate stays visible on the roster
  // (not hidden with orphaned data still attached to it), so the merge can just be
  // retried.
  await updateRecord<MemberFields>(TABLES.members, duplicateId, { Duplicate: true });

  const updated = await getStudentStatusById(survivorId);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
