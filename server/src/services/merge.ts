import { listRecords, getRecordOrNull, updateRecord, deleteRecord, TABLES, type AirtableRecord } from "../airtable/client.js";
import type { MemberFields, CreditFields, CheckinFields } from "../airtable/fields.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

// Repoints every already-fetched row whose `field` link includes `fromId` to point at
// `toId` instead — the actual "merge" mechanic. Most of a Member's stats (Classes
// Allowed, Available Credits, Remaining Today, Recently Active, ...) are Airtable
// rollups/formulas computed over these linked tables, so once the links move, those
// numbers recompute themselves; nothing here does that arithmetic by hand. Each
// update is independent and idempotent — re-pointing an already-correct link is a
// no-op — so a partial failure is always safe to just retry.
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

// Credits need their own pass rather than a plain repointLinks call: an Airtable
// automation grants every new Member row its own "New Member" signup credit, so a
// duplicate pair can genuinely end up with two of them (each row got its own grant —
// notably, a Member row created twice for one real signup by the webhook race this
// app used to have — see docs/airtable-automations/README.md). Left unhandled, that
// either hands the merged student two free drop-ins (both get reassigned) or strands
// one on the now-hidden duplicate forever (neither reachable nor counted). This
// collapses every "New Member" credit belonging to either side down to exactly one on
// the survivor:
//   - Prefer a credit that's already been consumed by a real check-in — that's the
//     actual record of what happened, worth keeping over an untouched duplicate
//     grant. Ties (several used, or none used) break on Granted At, oldest first, so
//     the pick is stable rather than depending on fetch order.
//   - Every other "New Member" credit is deleted outright, not just left orphaned —
//     "duplicate ends up with none" only holds if it's actually gone.
//   - Exception: two or more ALREADY-USED "New Member" credits means this person may
//     genuinely have redeemed a free class twice under two different duplicate rows —
//     not a simple duplicate-grant to silently collapse. Leaves them all as-is and
//     flags the check-ins that consumed them for a human to look at instead.
// Every other reason ("Drop-in Purchase", "Comp") has no such one-per-student
// expectation and always reassigns, uncapped. "Purchased By" (the payer) is a
// separate, unrelated link — a record of who paid, not which Member row currently
// holds the resulting credit — so it reassigns unconditionally too.
async function reassignCredits(survivorId: string, duplicateId: string): Promise<void> {
  const credits = await listRecords<CreditFields>(TABLES.credits, {
    fields: ["Member", "Purchased By", "Reason", "Consumed By Check-in", "Granted At"],
  });

  const newMemberCredits = credits.filter(
    (c) =>
      c.fields.Reason === "New Member" &&
      (c.fields.Member?.includes(survivorId) || c.fields.Member?.includes(duplicateId))
  );
  const usedNewMemberCredits = newMemberCredits.filter((c) => (c.fields["Consumed By Check-in"]?.length ?? 0) > 0);

  const extraNewMemberCreditIds = new Set<string>();
  if (newMemberCredits.length > 1) {
    if (usedNewMemberCredits.length >= 2) {
      console.warn(
        `[merge] ${usedNewMemberCredits.length} used "New Member" credits found merging ${duplicateId} into ` +
          `${survivorId} — flagging their check-ins for review instead of auto-resolving.`
      );
      const checkinIds = usedNewMemberCredits.flatMap((c) => c.fields["Consumed By Check-in"] ?? []);
      await Promise.all(
        checkinIds.map((id) =>
          updateRecord<CheckinFields>(TABLES.checkins, id, {
            "Needs Review": true,
            "Review Reason": "Multiple used New Member credits found while merging duplicate students — verify this student wasn't given two free classes.",
          })
        )
      );
    } else {
      const [, ...losers] = [...newMemberCredits].sort((a, b) => {
        const aUsed = usedNewMemberCredits.includes(a);
        const bUsed = usedNewMemberCredits.includes(b);
        if (aUsed !== bUsed) return aUsed ? -1 : 1;
        return (a.fields["Granted At"] ?? "").localeCompare(b.fields["Granted At"] ?? "");
      });
      for (const loser of losers) extraNewMemberCreditIds.add(loser.id);
    }
  }

  const memberUpdates = credits
    .filter((c) => c.fields.Member?.includes(duplicateId))
    .filter((c) => !extraNewMemberCreditIds.has(c.id))
    .map((c) => updateRecord<CreditFields>(TABLES.credits, c.id, { Member: [survivorId] }));

  const purchasedByUpdates = credits
    .filter((c) => c.fields["Purchased By"]?.includes(duplicateId))
    .filter((c) => !extraNewMemberCreditIds.has(c.id))
    .map((c) => updateRecord<CreditFields>(TABLES.credits, c.id, { "Purchased By": [survivorId] }));

  const deletions = [...extraNewMemberCreditIds].map((id) => deleteRecord(TABLES.credits, id));

  await Promise.all([...memberUpdates, ...purchasedByUpdates, ...deletions]);
}

// Never overwrites a value the survivor already has — the survivor's own identity
// (name, email) and any data it already carries is always authoritative. Only fills
// in something the survivor is missing but the absorbed duplicate happened to have,
// so real data (an assessed level, a phone number) recorded under the wrong row isn't
// silently lost.
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

  const [checkins, recurringPlans, transactions, levelups, notes] = await Promise.all([
    listRecords(TABLES.checkins, { fields: ["Member"] }),
    listRecords(TABLES.recurringPlans, { fields: ["Member", "Covers Member"] }),
    listRecords(TABLES.transactions, { fields: ["Member"] }),
    listRecords(TABLES.levelups, { fields: ["Member"] }),
    listRecords(TABLES.notes, { fields: ["Member"] }),
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
    reassignCredits(survivorId, duplicateId),
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
