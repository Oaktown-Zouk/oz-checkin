// ═══════════════════════════════════════════════════════════════════════
// Automation B (see docs/airtable-schema.md's "Credits" section) — sets how many
// drop-in credits a qualifying Transactions record is worth (succeeded, one-time,
// no plan). Trigger: "When a record matches conditions" on Transactions, filtered
// to that qualifying view.
//
// Input variables (mapped from the triggering Transaction record):
//   transactionId — the Transaction's own Airtable record id
//   planId        — Plan ID text field, blank for a one-time payment
//   dollarAmount  — Amount paid
//
// No Member lookup any more -- as of the 2026-09 credits rework, this only ever
// sets "Credits Purchased" on the triggering Transaction itself, and
// Members."Credits Purchased" (a rollup) picks it up automatically. That fully
// retires the class of bug this script used to have (a mis-resolved member id from
// the old memberIds input variable, fixed once already before this rewrite) --
// there's no member id to resolve any more, so it can't be resolved wrong.
// ═══════════════════════════════════════════════════════════════════════

const { transactionId, planId, dollarAmount } = input.config();

const transactionsTable = base.getTable('Transactions');
const tiersTable = base.getTable('Tiers');

const tiers = await tiersTable.selectRecordsAsync({ fields: ['Min Monthly Price'] });
const membershipAmounts = tiers.records.map((record) => record.getCellValue('Min Monthly Price') || 9999);
const minMembershipAmount = Math.min(...membershipAmounts);

const dropinPrice = 30;
const minDropinPrice = 25;

if (!!planId && dollarAmount >= minMembershipAmount) {
  console.log('Billed for recurring plan, not drop-in');
  // Handled by membership automation.
  return;
}

console.log(`Processing payment of ${dollarAmount} for transaction ${transactionId}`);

let numberOfCredits = Math.floor(dollarAmount / dropinPrice);
if (numberOfCredits < 1 && dollarAmount >= minDropinPrice) {
  numberOfCredits = 1;
}

if (numberOfCredits < 1) {
  console.warn(`Payment is less than minimum of ${minDropinPrice} for a credit`);
  return; // Consider throwing an exception instead?
}

await transactionsTable.updateRecordAsync(transactionId, { 'Credits Purchased': numberOfCredits });

console.log(`Set Credits Purchased = ${numberOfCredits} on transaction ${transactionId}`);
