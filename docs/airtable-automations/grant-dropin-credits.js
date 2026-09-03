// ═══════════════════════════════════════════════════════════════════════
// Automation B (see docs/airtable-schema.md's "Credits" section) — grants a
// Drop-in Purchase credit when a Transactions record qualifies (succeeded,
// one-time, no plan). Trigger: "When a record matches conditions" on
// Transactions, filtered to that qualifying view.
//
// Input variables (mapped from the triggering Transaction record):
//   transactionId — the Transaction's own Airtable record id
//   planId        — Plan ID text field, blank for a one-time payment
//   dollarAmount  — Amount paid
// (memberIds is deliberately NOT read here — see the comment below.)
// ═══════════════════════════════════════════════════════════════════════

const { transactionId, planId, dollarAmount } = input.config();

const transactionsTable = base.getTable('Transactions');
const tiersTable = base.getTable('Tiers');
const creditsTable = base.getTable('Credits');

// `memberIds` used to come straight from input.config(), but that input variable
// was mapped to the linked Member field's PRIMARY FIELD VALUE (the person's name),
// not its record id -- {id: memberId} below then tried to link a Credits record to
// a Member using a name string as if it were an Airtable record id, which silently
// fails to link anything real. Fetching the Transaction record directly and reading
// its own Member field instead always returns real {id, name} linked-record
// objects, regardless of how any input variable happens to be configured -- so this
// is both the fix and no longer dependent on that config being right. (The
// `memberIds` input variable can be removed from this automation's Run Script step
// now that nothing here reads it.)
const transactionRecord = await transactionsTable.selectRecordAsync(transactionId, { fields: ['Member'] });
if (!transactionRecord) {
  throw new Error(`Transaction ${transactionId} not found`);
}
const memberLinks = transactionRecord.getCellValue('Member') ?? [];
if (memberLinks.length !== 1) {
  throw new Error(`Unexpected number of members attached to transaction. Expected 1 but got ${memberLinks.length}`);
}
const memberId = memberLinks[0].id;

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

console.log(`Processing payment of ${dollarAmount} from member ${memberId}`);

let numberOfCredits = Math.floor(dollarAmount / dropinPrice);
if (numberOfCredits < 1 && dollarAmount >= minDropinPrice) {
  numberOfCredits = 1;
}

if (numberOfCredits < 1) {
  console.warn(`Payment is less than minimum of ${minDropinPrice} for a credit`);
  return; // Consider throwing an exception instead?
}

const now = new Date().toISOString();
const creditsToCreate = Array.from({ length: numberOfCredits }, () => ({
  fields: {
    Member: [{ id: memberId }],
    'Purchased By': [{ id: memberId }],
    'Source Transaction': [{ id: transactionId }],
    'Granted At': now,
    Reason: { name: 'Drop-in Purchase' },
  },
}));

// Was missing `await` -- the run could finish (and Airtable would mark it
// successful) before these were actually written, and any creation error would be
// silently dropped instead of failing the run.
await creditsTable.createRecordsAsync(creditsToCreate);

// Was `${creditsToCreate}`, which stringifies the array itself
// ("[object Object],[object Object]") instead of the count.
console.log(`Created ${creditsToCreate.length} credits for ${memberId}`);
