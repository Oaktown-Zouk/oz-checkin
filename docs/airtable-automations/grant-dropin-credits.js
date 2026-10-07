// ═══════════════════════════════════════════════════════════════════════
// grant-dropin-credits.js (see docs/airtable-schema.md's "Credits" section) — sets
// how many drop-in credits a qualifying Transactions record is worth (succeeded,
// one-time, no plan). Trigger: "When a record is created" on Transactions — the
// qualifying check happens inside the script itself (below), not a filtered
// trigger view, so it runs on every new Transaction and no-ops on the ones that
// don't qualify.
//
// Input variables (mapped from the triggering Transaction record):
//   transactionId             — the Transaction's own Airtable record id
//   planId                    — Plan ID text field, blank for a one-time payment
//   dollarAmount              — Amount paid
//   campaign                  — Campaign text field (Givebutter's campaign_code in
//                                practice for this base, not a display title)
//   notaflofCreditsRequested  — NOTAFLOF Credits Requeested number field, only ever
//                                set on the NOTAFLOF drop-in campaign's own
//                                transactions (see transactionFields.ts's
//                                notaflofCreditsRequested) — blank/null for every
//                                other transaction, including a NOTAFLOF membership
//                                one (a separate campaign that doesn't ask this).
//
// No Member lookup: this only ever sets "Credits Purchased" on the triggering
// Transaction itself, and Members."Credits Purchased" (a rollup) picks it up
// automatically -- there's no member id involved at all, so there's nothing to
// resolve wrong. See docs/airtable-automations/CHANGELOG.md for the design history.
// ═══════════════════════════════════════════════════════════════════════

const { transactionId, planId, dollarAmount, campaign, notaflofCreditsRequested } = input.config();

// The NOTAFLOF ("none turned away for lack of funds") drop-in campaign -- pay
// whatever you can, so its dollar amount can't be used to infer a class count the
// way a regular drop-in's fixed sliding-scale price can.
const NOTAFLOF_DROPINS_CAMPAIGN = 'ZROVNN';

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

let numberOfCredits;
if (campaign === NOTAFLOF_DROPINS_CAMPAIGN) {
  if (notaflofCreditsRequested > 0) {
    numberOfCredits = notaflofCreditsRequested;
  } else {
    console.warn('NOTAFLOF transaction with no NOTAFLOF Credits Requeested value -- defaulting to 1 credit');
    numberOfCredits = 1;
  }
} else {
  numberOfCredits = Math.floor(dollarAmount / dropinPrice);
  if (numberOfCredits < 1 && dollarAmount >= minDropinPrice) {
    numberOfCredits = 1;
  }
}

if (numberOfCredits < 1) {
  console.warn(`Payment is less than minimum of ${minDropinPrice} for a credit`);
  return; // Consider throwing an exception instead?
}

await transactionsTable.updateRecordAsync(transactionId, { 'Credits Purchased': numberOfCredits });

console.log(`Set Credits Purchased = ${numberOfCredits} on transaction ${transactionId}`);
