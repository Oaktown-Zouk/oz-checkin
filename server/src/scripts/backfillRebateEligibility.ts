// One-time backfill for the first-time-membership rebate: marks Rebate Status/
// Rebate Eligible for every member who already had a qualifying first recurring
// payment before the Airtable automations (server/airtable-automations/) started
// doing this on every new payment going forward — see
// docs/airtable-schema.md's "Rebates" section and rebateEligibility.ts's own
// comment for the underlying decision logic, which this mirrors exactly.
//
// Members."First Recurring Key" and Transactions."Recurring Payment Key" are
// pre-existing Airtable formula/rollup fields; a transaction IS a member's first
// qualifying recurring payment iff its own key equals the member's. Only ever
// moves Rebate Status from blank/"New" to "Refund Eligible" — a status further
// along the pipeline (Refund Requested, Refund Processed, ...) is left alone, and
// re-marking the same qualifying transaction "50%" on a later run is a harmless
// no-op, not a drift risk (see rebateEligibility.ts).
//
// Dry run by default — pass --apply to write. Safe to re-run any time; this is the
// same full-table pass the nightly Transactions sync now also runs every night, so
// once the updated automation is live this script should find nothing left to do.

import { listRecords, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields, TransactionFields } from "../airtable/fields.js";

const APPLY = process.argv.includes("--apply");

function decideRebateUpdate(
  transactionRecurringPaymentKey: number | null,
  memberFirstRecurringKey: number | null,
  currentRebateStatus: string | null | undefined
): { markTransactionRebateEligible: boolean; markMemberRefundEligible: boolean } {
  const isFirstPayment =
    transactionRecurringPaymentKey != null &&
    memberFirstRecurringKey != null &&
    transactionRecurringPaymentKey === memberFirstRecurringKey;

  if (!isFirstPayment) {
    return { markTransactionRebateEligible: false, markMemberRefundEligible: false };
  }
  const untouched = !currentRebateStatus || currentRebateStatus === "New";
  return { markTransactionRebateEligible: true, markMemberRefundEligible: untouched };
}

async function main() {
  console.log(APPLY ? "Running for real (--apply passed).\n" : "DRY RUN — pass --apply to actually write.\n");

  const members = await listRecords<MemberFields>(TABLES.members, {
    fields: ["Full Name", "First Recurring Key", "Rebate Status"],
  });
  const memberById = new Map(members.map((m) => [m.id, m]));

  const transactions = await listRecords<TransactionFields>(TABLES.transactions, {
    fields: ["Member", "Recurring Payment Key", "Rebate Eligible"],
  });
  const candidates = transactions.filter(
    (t) => t.fields["Recurring Payment Key"] != null && t.fields["Rebate Eligible"] !== "50%"
  );

  if (candidates.length === 0) {
    console.log("No candidates found — every qualifying transaction is already marked.");
    return;
  }

  let transactionsFixed = 0;
  let membersFixed = 0;
  for (const t of candidates) {
    const memberId = t.fields.Member?.[0];
    const member = memberId ? memberById.get(memberId) : undefined;
    if (!member) continue;

    const decision = decideRebateUpdate(
      t.fields["Recurring Payment Key"] ?? null,
      member.fields["First Recurring Key"] ?? null,
      member.fields["Rebate Status"] ?? null
    );
    if (!decision.markTransactionRebateEligible) continue;

    console.log(
      `  ${t.id} | ${member.fields["Full Name"] ?? "Unnamed"} -> Rebate Eligible = "50%"` +
        (decision.markMemberRefundEligible ? `, Rebate Status = "Refund Eligible"` : "")
    );
    transactionsFixed++;
    if (decision.markMemberRefundEligible) membersFixed++;

    if (APPLY) {
      await updateRecord<TransactionFields>(TABLES.transactions, t.id, { "Rebate Eligible": "50%" });
      if (decision.markMemberRefundEligible) {
        await updateRecord<MemberFields>(TABLES.members, member.id, { "Rebate Status": "Refund Eligible" });
      }
    }
  }

  console.log(`\n${transactionsFixed} transaction(s) to fix, ${membersFixed} member(s) newly marked Refund Eligible.`);

  if (!APPLY) {
    console.log("\nDry run only — no writes made. Re-run with --apply to fix these.");
  } else {
    console.log(`\nDone.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
