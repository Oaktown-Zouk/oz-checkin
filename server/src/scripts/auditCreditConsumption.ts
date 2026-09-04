// Finds check-ins that should have consumed a credit but didn't: a check-in belongs to
// a member with no Tier Rule (so Classes Allowed is 0 — any check-in is "over
// allowance"), and has no "Credits Consumed" set. Written after a manual sweep
// (2026-08-23) turned up 5 such check-ins from a batch of Form-submitted trial-class
// sign-ins, whose credits sat unconsumed. The user suspects this may recur, hence a
// real script instead of a one-off.
//
// services/checkins.ts consumes/flags credits itself synchronously for every check-in
// it creates (see gateCheckIns). This script stays useful regardless: for auditing
// check-ins that predate that becoming the only consumption path, and as a general
// sanity check against drift (e.g. a check-in created directly in Airtable, bypassing
// the app entirely).
//
// A gap is only auto-fixed if the member currently has an available credit — this
// script never fabricates a credit (that's a judgment call, see the Dvij Patel case in
// docs/airtable-schema.md, which needed a specific transaction/backstory this script
// has no way to know). Gaps with no available credit are just reported.
//
// Dry run by default — pass --apply to write.

import { listRecords, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields, CheckinFields } from "../airtable/fields.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "Running for real (--apply passed).\n" : "DRY RUN — pass --apply to actually write.\n");

  const members = await listRecords<MemberFields>(TABLES.members, {
    fields: ["Full Name", "Access Status", "Tier Rule", "Duplicate", "Available Credits"],
  });
  const tierlessMemberIds = new Set(
    members.filter((m) => !m.fields.Duplicate && !(m.fields["Tier Rule"]?.length)).map((m) => m.id)
  );
  const nameById = new Map(members.map((m) => [m.id, m.fields["Full Name"] ?? "Unnamed"]));
  const accessById = new Map(members.map((m) => [m.id, m.fields["Access Status"] ?? "?"]));
  const availableCreditsById = new Map(members.map((m) => [m.id, m.fields["Available Credits"] ?? 0]));

  const checkins = await listRecords<CheckinFields>(TABLES.checkins, {
    filterByFormula: "{Undone At} = BLANK()",
    fields: ["Member", "Checked In At", "Needs Review", "Review Reason", "Credits Consumed"],
  });

  const gaps = checkins
    .filter((c) => {
      const memberId = c.fields.Member?.[0];
      return memberId && tierlessMemberIds.has(memberId) && !c.fields["Credits Consumed"];
    })
    .sort((a, b) => (a.fields["Checked In At"] ?? "").localeCompare(b.fields["Checked In At"] ?? ""));

  if (gaps.length === 0) {
    console.log("No gaps found — every tier-less member's check-ins have consumed a credit.");
    return;
  }

  console.log(`${gaps.length} check-in(s) belong to a tier-less member with no credit consumed:\n`);

  // Available Credits is a snapshot from the top of this run — an --apply write made
  // moments earlier here doesn't retroactively lower it, so gaps for the same member
  // are claimed against a running "already claimed this run" count instead.
  const claimedThisRun = new Map<string, number>();
  let fixable = 0;
  let unfixable = 0;
  for (const c of gaps) {
    const memberId = c.fields.Member![0];
    const available = (availableCreditsById.get(memberId) ?? 0) - (claimedThisRun.get(memberId) ?? 0);
    const reviewNote = c.fields["Needs Review"] ? `flagged: ${c.fields["Review Reason"]}` : "not flagged";

    if (available > 0) {
      fixable++;
      claimedThisRun.set(memberId, (claimedThisRun.get(memberId) ?? 0) + 1);
      console.log(
        `  ${c.id} | ${nameById.get(memberId)} (${accessById.get(memberId)}) | ${c.fields["Checked In At"]} | ${reviewNote}` +
          ` -> would set Credits Consumed = 1`
      );
      if (APPLY) {
        await updateRecord<CheckinFields>(TABLES.checkins, c.id, { "Credits Consumed": 1 });
      }
    } else {
      unfixable++;
      console.log(
        `  ${c.id} | ${nameById.get(memberId)} (${accessById.get(memberId)}) | ${c.fields["Checked In At"]} | ${reviewNote}` +
          ` -> NO available credit, needs manual review`
      );
    }
  }

  console.log(`\n${fixable} fixable by setting Credits Consumed, ${unfixable} need manual attention.`);

  if (!APPLY) {
    console.log("\nDry run only — no writes made. Re-run with --apply to fix the fixable ones.");
  } else {
    console.log(`\nDone. ${fixable} check-in(s) updated.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
