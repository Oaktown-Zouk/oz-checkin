// Finds check-ins that should have consumed a credit but didn't: a check-in belongs to
// a member with no Tier Rule (so Classes Allowed is 0 — any check-in is "over
// allowance"), and has no Credits record consumed by it. Written after a manual sweep
// (2026-08-23) turned up 5 such check-ins from a batch of Form-submitted trial-class
// sign-ins, whose credits sat unlinked. The user suspects this may recur, hence a real
// script instead of a one-off.
//
// services/checkins.ts consumes/flags credits itself synchronously for every check-in
// it creates (see gateCheckIns). This script stays useful regardless: for auditing
// check-ins that predate that becoming the only consumption path, and as a general
// sanity check against drift (e.g. a check-in created directly in Airtable, bypassing
// the app entirely).
//
// A gap is only auto-fixed if the member already has an unclaimed Available credit —
// this script never creates new credits (that's a judgment call, see the Dvij Patel
// case in docs/airtable-schema.md, which needed a specific transaction/backstory this
// script has no way to know). Gaps with no available credit are just reported.
//
// Dry run by default — pass --apply to write.

import { listRecords, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields, CheckinFields, CreditFields } from "../airtable/fields.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "Running for real (--apply passed).\n" : "DRY RUN — pass --apply to actually write.\n");

  const members = await listRecords<MemberFields>(TABLES.members, {
    fields: ["Full Name", "Access Status", "Tier Rule", "Duplicate"],
  });
  const tierlessMemberIds = new Set(
    members.filter((m) => !m.fields.Duplicate && !(m.fields["Tier Rule"]?.length)).map((m) => m.id)
  );
  const nameById = new Map(members.map((m) => [m.id, m.fields["Full Name"] ?? "Unnamed"]));
  const accessById = new Map(members.map((m) => [m.id, m.fields["Access Status"] ?? "?"]));

  const checkins = await listRecords<CheckinFields>(TABLES.checkins, {
    filterByFormula: "{Undone At} = BLANK()",
    fields: ["Member", "Checked In At", "Needs Review", "Review Reason"],
  });

  const credits = await listRecords<CreditFields>(TABLES.credits, {
    fields: ["Member", "Available", "Granted At", "Consumed By Check-in"],
  });
  const checkinsWithCredit = new Set<string>();
  for (const c of credits) for (const id of c.fields["Consumed By Check-in"] ?? []) checkinsWithCredit.add(id);

  // Oldest-first per member, matching the "consume oldest available credit" convention
  // used everywhere else in this app (services/checkins.ts's gateCheckIns).
  const availableCreditsByMember = new Map<string, { id: string; grantedAt: string }[]>();
  for (const c of credits) {
    if (!c.fields.Available) continue;
    const memberId = c.fields.Member?.[0];
    if (!memberId) continue;
    const list = availableCreditsByMember.get(memberId) ?? [];
    list.push({ id: c.id, grantedAt: c.fields["Granted At"] ?? "" });
    availableCreditsByMember.set(memberId, list);
  }
  for (const list of availableCreditsByMember.values()) list.sort((a, b) => a.grantedAt.localeCompare(b.grantedAt));

  const gaps = checkins
    .filter((c) => {
      const memberId = c.fields.Member?.[0];
      return memberId && tierlessMemberIds.has(memberId) && !checkinsWithCredit.has(c.id);
    })
    .sort((a, b) => (a.fields["Checked In At"] ?? "").localeCompare(b.fields["Checked In At"] ?? ""));

  if (gaps.length === 0) {
    console.log("No gaps found — every tier-less member's check-ins have a consumed credit.");
    return;
  }

  console.log(`${gaps.length} check-in(s) belong to a tier-less member with no associated credit:\n`);

  let fixable = 0;
  let unfixable = 0;
  for (const c of gaps) {
    const memberId = c.fields.Member![0];
    const pool = availableCreditsByMember.get(memberId) ?? [];
    const credit = pool.shift(); // claims it so a second gap for the same member doesn't reuse it
    const reviewNote = c.fields["Needs Review"] ? `flagged: ${c.fields["Review Reason"]}` : "not flagged";

    if (credit) {
      fixable++;
      console.log(
        `  ${c.id} | ${nameById.get(memberId)} (${accessById.get(memberId)}) | ${c.fields["Checked In At"]} | ${reviewNote}` +
          ` -> would link credit ${credit.id} (granted ${credit.grantedAt})`
      );
      if (APPLY) {
        await updateRecord<CreditFields>(TABLES.credits, credit.id, {
          "Consumed By Check-in": [c.id],
        });
      }
    } else {
      unfixable++;
      console.log(
        `  ${c.id} | ${nameById.get(memberId)} (${accessById.get(memberId)}) | ${c.fields["Checked In At"]} | ${reviewNote}` +
          ` -> NO available credit to link, needs manual review`
      );
    }
  }

  console.log(`\n${fixable} fixable by linking an existing unclaimed credit, ${unfixable} need manual attention.`);

  if (!APPLY) {
    console.log("\nDry run only — no writes made. Re-run with --apply to link the fixable ones.");
  } else {
    console.log(`\nDone. ${fixable} credit(s) linked.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
