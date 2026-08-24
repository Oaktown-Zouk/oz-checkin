// Computes the subset of Airtable's formula/rollup fields this app's own logic
// actually depends on staying live/consistent with its own mutations, and simulates
// the two Airtable automations whose side effects the live (non-backdated) check-in
// path implicitly relies on. See mockClient.ts for how these get wired into
// createRecords/updateRecord/listRecords/getRecord.
//
// Deliberately NOT computed here (fixture-static instead — seed data sets them
// directly, same as Airtable would have already resolved them): Members.Access
// Status/Membership Status/Tier Name/Classes Allowed/Recently Active, Recurring
// Plans.Is Active Membership/Is Paid Access. Confirmed via grep that Tier Name/
// Classes Allowed are read as plain already-resolved fields with no in-app `Tiers`
// join, and the Is Active/Paid Access fields aren't read anywhere at all — modeling a
// full Recurring Plans -> Access Status derivation would be real effort replicating a
// formula the docs don't even pin down precisely, for no app behavior that needs it.
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

// "Checked In Today (Live)" — count of this member's non-undone check-ins on dateStr,
// optionally excluding a set of ids (used to get the *prior* count for a batch of
// check-ins that are already sitting in the store by the time Automation C runs).
function checkedInCountOn(store: Store, memberId: string, dateStr: string, exclude?: Set<string>): number {
  let count = 0;
  for (const c of table(store, TABLES.checkins).values()) {
    if (exclude?.has(c.id)) continue;
    if (!linksTo(c.fields, "Member", memberId)) continue;
    if (!isBlank(c.fields["Undone At"])) continue;
    const at = c.fields["Checked In At"];
    if (isBlank(at) || dateStringFor(new Date(at as string)) !== dateStr) continue;
    count++;
  }
  return count;
}

function availableCreditsFor(store: Store, memberId: string): RawRecord[] {
  return [...table(store, TABLES.credits).values()]
    .filter((c) => linksTo(c.fields, "Member", memberId) && isBlank(c.fields["Consumed By Check-in"]))
    .sort((a, b) => String(a.fields["Granted At"] ?? "").localeCompare(String(b.fields["Granted At"] ?? "")));
}

// Members.Available Credits / Checked In Today (Live) / Remaining Today — the three
// fields the whole check-in/eligibility flow actually gates on. Everything else on
// the member passes through untouched (fixture-static, see file header).
export function computeMemberFields(member: RawRecord, store: Store): Record<string, unknown> {
  const classesAllowed = Number(member.fields["Classes Allowed"] ?? 0);
  const checkedInToday = checkedInCountOn(store, member.id, today());
  return {
    ...member.fields,
    "Available Credits": availableCreditsFor(store, member.id).length,
    "Checked In Today (Live)": checkedInToday,
    "Remaining Today": classesAllowed - checkedInToday,
  };
}

// Credits.Available — true iff Consumed By Check-in is unlinked (matches
// docs/airtable-schema.md exactly: not based on Consumed At, so a credit self-heals
// if its consuming check-in is ever deleted directly rather than undone).
export function computeCreditFields(credit: RawRecord): Record<string, unknown> {
  return {
    ...credit.fields,
    Available: isBlank(credit.fields["Consumed By Check-in"]) ? 1 : 0,
  };
}

function consumeOldestCreditOrFlag(store: Store, memberId: string, checkinId: string): void {
  const candidate = availableCreditsFor(store, memberId)[0];
  if (candidate) {
    candidate.fields["Consumed At"] = new Date().toISOString();
    candidate.fields["Consumed By Check-in"] = [checkinId];
  } else {
    const checkin = table(store, TABLES.checkins).get(checkinId);
    if (checkin) {
      checkin.fields["Needs Review"] = true;
      checkin.fields["Review Reason"] = "Beyond tier allowance, no credit available";
    }
  }
}

// Automation C — fires on every new Check-ins record whose Checked In At is literally
// today: if the member's Remaining Today (post-creation) is negative, consumes their
// oldest Available credit, or flags Needs Review if none exists. Mirrors
// services/checkins.ts's gateBackdatedCheckIns/consumeOldestCreditOrFlag exactly,
// just triggered automatically instead of called explicitly (that backdated path
// still calls its own copy directly — Automation C never fires for a non-today date,
// same as real Airtable).
export function applyLiveCheckinAutomation(store: Store, createdCheckinIds: string[]): void {
  const todayStr = today();
  const createdIdSet = new Set(createdCheckinIds);

  // Group today's newly-created ids by member, preserving creation order — a batch
  // (e.g. checking into 2 classes at once) must be evaluated incrementally, exactly
  // like gateBackdatedCheckIns's nth-today-check, not all against the same final
  // count (which would wrongly flag the *first* selection instead of whichever one
  // actually crosses the allowance line).
  const idsByMember = new Map<string, string[]>();
  for (const id of createdCheckinIds) {
    const checkin = table(store, TABLES.checkins).get(id);
    if (!checkin) continue;
    const at = checkin.fields["Checked In At"];
    if (isBlank(at) || dateStringFor(new Date(at as string)) !== todayStr) continue;
    const memberId = (checkin.fields.Member as string[] | undefined)?.[0];
    if (!memberId) continue;
    const list = idsByMember.get(memberId) ?? [];
    list.push(id);
    idsByMember.set(memberId, list);
  }

  for (const [memberId, ids] of idsByMember) {
    const member = table(store, TABLES.members).get(memberId);
    if (!member) continue;
    const classesAllowed = Number(member.fields["Classes Allowed"] ?? 0);
    const priorCount = checkedInCountOn(store, memberId, todayStr, createdIdSet);
    ids.forEach((id, i) => {
      const nth = priorCount + i + 1;
      if (nth > classesAllowed) consumeOldestCreditOrFlag(store, memberId, id);
    });
  }
}

// Automation D — a Check-ins record's Undone At becomes non-blank -> frees whichever
// credit it had consumed (clears Consumed At/Consumed By Check-in).
export function applyUndoAutomation(store: Store, checkinId: string): void {
  for (const credit of table(store, TABLES.credits).values()) {
    if (linksTo(credit.fields, "Consumed By Check-in", checkinId)) {
      delete credit.fields["Consumed At"];
      delete credit.fields["Consumed By Check-in"];
    }
  }
}
