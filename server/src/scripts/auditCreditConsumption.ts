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
// Every gap found gets fixed the same way gateCheckIns would have: Credits Consumed
// set to 1 unconditionally (a numeric balance can go negative, so there's no reason
// to withhold it), and Needs Review/Review Reason = "Negative balance" set too if
// applying it pushes that member's running balance below zero — tracked per member
// across this run's own fixes, same reasoning as gateCheckIns's in-memory balance.
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

  // Running balance per member across this run's own fixes — a --apply write made
  // moments earlier here doesn't retroactively lower Available Credits (a formula) in
  // this already-fetched snapshot, so each member's balance is tracked in memory
  // instead, decremented by every gap fixed for them so far.
  const runningBalance = new Map<string, number>();
  let flagged = 0;
  for (const c of gaps) {
    const memberId = c.fields.Member![0];
    if (!runningBalance.has(memberId)) runningBalance.set(memberId, availableCreditsById.get(memberId) ?? 0);
    const balanceAfter = runningBalance.get(memberId)! - 1;
    runningBalance.set(memberId, balanceAfter);

    const alreadyFlagged = c.fields["Needs Review"];
    const willFlag = balanceAfter < 0 && !alreadyFlagged;
    if (willFlag) flagged++;
    const note = alreadyFlagged ? `already flagged: ${c.fields["Review Reason"]}` : willFlag ? "will flag: Negative balance" : "not flagged";

    console.log(
      `  ${c.id} | ${nameById.get(memberId)} (${accessById.get(memberId)}) | ${c.fields["Checked In At"]} | ${note}` +
        ` -> would set Credits Consumed = 1`
    );
    if (APPLY) {
      await updateRecord<CheckinFields>(TABLES.checkins, c.id, {
        "Credits Consumed": 1,
        ...(willFlag ? { "Needs Review": true, "Review Reason": "Negative balance" } : {}),
      });
    }
  }

  console.log(`\n${gaps.length} check-in(s) to fix, ${flagged} of them newly flagged for a negative balance.`);

  if (!APPLY) {
    console.log("\nDry run only — no writes made. Re-run with --apply to fix these.");
  } else {
    console.log(`\nDone. ${gaps.length} check-in(s) updated.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
