// Computes the subset of Airtable's formula/rollup fields this app's own logic
// actually depends on staying live/consistent with its own mutations. No automation
// simulation lives here at all — credit consumption on create and freeing a credit
// on undo are both plain application code (services/checkins.ts), so the mock just
// needs to serve listRecords/updateRecord calls like any other write. See
// mockClient.ts for how these get wired into
// createRecords/updateRecord/listRecords/getRecord.
//
// Deliberately NOT computed here (fixture-static instead — seed data sets them
// directly, same as Airtable would have already resolved them): Members.Access
// Status/Membership Status/Tier Name/Classes Allowed/Recently Active, Recurring
// Plans.Is Active Membership/Is Paid Access. Tier Name/Classes Allowed are read as
// plain already-resolved fields with no in-app `Tiers` join, and the Is Active/Paid
// Access fields aren't read anywhere at all — modeling a full Recurring Plans ->
// Access Status derivation would be real effort replicating a formula the docs don't
// even pin down precisely, for no app behavior that needs it.
import { TABLES } from "./tableIds.js";
import { isBlank } from "./mockFormula.js";
import { today, dateStringFor } from "../lib/date.js";

export interface RawRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

// What a fixture/seed provides — createdTime is optional since seed data rarely
// cares what it is, unlike a RawRecord already sitting in the store.
export interface SeedRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}
export type SeedData = Partial<Record<string, SeedRecord[]>>;

// tableId -> recordId -> record. Shared mutable store the mock client owns; these
// functions read and mutate it directly (mutating fields in place, same as a real
// automation would update a row out from under whoever's about to read it next).
export type Store = Map<string, Map<string, RawRecord>>;

function table(store: Store, id: string): Map<string, RawRecord> {
  let t = store.get(id);
  if (!t) {
    t = new Map();
    store.set(id, t);
  }
  return t;
}

function linksTo(fields: Record<string, unknown>, field: string, id: string): boolean {
  return ((fields[field] as string[] | undefined) ?? []).includes(id);
}

// "Checked In Today (Live)" — count of this member's non-undone check-ins on dateStr.
function checkedInCountOn(store: Store, memberId: string, dateStr: string): number {
  let count = 0;
  for (const c of table(store, TABLES.checkins).values()) {
    if (!linksTo(c.fields, "Member", memberId)) continue;
    if (!isBlank(c.fields["Undone At"])) continue;
    const at = c.fields["Checked In At"];
    if (isBlank(at) || dateStringFor(new Date(at as string)) !== dateStr) continue;
    count++;
  }
  return count;
}

// Members.Available Credits = Credits Purchased + New Member Credit + Comp Credits
// - Credits Consumed, all summed straight off the underlying tables — same real
// formula/rollup arrangement Airtable itself is configured with (see
// docs/airtable-schema.md's "Credits" section), not something this mock reimplements
// differently.
function sumField(store: Store, tableId: string, field: string, memberId: string): number {
  let total = 0;
  for (const r of table(store, tableId).values()) {
    if (!linksTo(r.fields, "Member", memberId)) continue;
    total += Number(r.fields[field] ?? 0);
  }
  return total;
}

function availableCreditsFor(store: Store, member: RawRecord): number {
  const purchased = sumField(store, TABLES.transactions, "Credits Purchased", member.id);
  const comp = sumField(store, TABLES.compCredits, "Amount", member.id);
  const consumed = sumField(store, TABLES.checkins, "Credits Consumed", member.id);
  const newMemberCredit = Number(member.fields["New Member Credit"] ?? 0);
  return purchased + newMemberCredit + comp - consumed;
}

// Members' Lookup-through-Levelups fields (see MemberFields's comment in fields.ts)
// — same idea as availableCreditsFor, but simulating what the real Lookup fields
// resolve to rather than something the app itself mutates. Real Airtable Lookups
// drop an entry outright when the source is blank on that linked record (confirmed
// against the real base, not simulated generally here) — "safe" here just means the
// mock never produces a blank From/To to drop in the first place, matching the real
// "From (safe)"/"To (safe)" formula fields' -1-for-blank convention.
function levelupsFor(store: Store, memberId: string): RawRecord[] {
  return [...table(store, TABLES.levelups).values()].filter((l) => linksTo(l.fields, "Member", memberId));
}

// Members.Available Credits / Checked In Today (Live) / Remaining Today / the
// Levelups lookup fields — everything the whole check-in/eligibility/timeline flow
// actually gates on. Everything else on the member passes through untouched
// (fixture-static, see file header).
export function computeMemberFields(member: RawRecord, store: Store): Record<string, unknown> {
  const classesAllowed = Number(member.fields["Classes Allowed"] ?? 0);
  const checkedInToday = checkedInCountOn(store, member.id, today());
  const myLevelups = levelupsFor(store, member.id);
  return {
    ...member.fields,
    "Available Credits": availableCreditsFor(store, member),
    "Checked In Today (Live)": checkedInToday,
    "Remaining Today": classesAllowed - checkedInToday,
    "Role (from Levelups)": myLevelups.map((l) => l.fields.Role),
    "From (safe, from Levelups)": myLevelups.map((l) => (isBlank(l.fields.From) ? -1 : l.fields.From)),
    "To (safe, from Levelups)": myLevelups.map((l) => (isBlank(l.fields.To) ? -1 : l.fields.To)),
    "Issuer Name (from Levelups)": myLevelups.map((l) => (l.fields["Issuer Name"] as string[] | undefined)?.[0]),
    "Created (from Levelups)": myLevelups.map((l) => l.createdTime),
  };
}

