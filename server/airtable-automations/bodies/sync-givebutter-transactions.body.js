// ═══════════════════════════════════════════════════════════════════════
// Givebutter → Airtable :: TRANSACTIONS  (payment history)
//
// Airtable → Automations → Trigger "At scheduled time" (daily, 3:15 AM PT)
//          → Action "Run a script"  ·  no input variables needed
//
// Rolling window, not a full pull — self-heals any gap shorter than
// LOOKBACK_DAYS. For the one-time historical backfill, set it to 3650,
// run manually, then set it back to 7 before enabling the schedule.
//
// NAMES: writes First Name / Last Name only when creating a member, or to
// fill a blank. It never overwrites a name that /plans already set, because
// transactions sometimes carry only a single combined name and splitting
// that is guesswork.
// ═══════════════════════════════════════════════════════════════════════

const GIVEBUTTER_API_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY'; // ← Settings → Integrations → API Keys — fill in only inside Airtable's own script editor, never commit the real value here
const GIVEBUTTER_API_BASE = 'https://api.givebutter.com/v1';
const LOOKBACK_DAYS = 7;      // ← 3650 for the historical backfill
const MAX_PAGES     = 40;     // Airtable caps a script at 50 fetch() calls

const membersTable      = base.getTable('Members');
const transactionsTable = base.getTable('Transactions');
const syncLogTable      = base.getTable('Sync Log');

async function fetchFromGivebutter(path) {
  const response = await fetch(`${GIVEBUTTER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GIVEBUTTER_API_KEY}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Givebutter ${response.status} on ${path}: ${await response.text()}`);
  return response.json();
}

// See sync-givebutter-plans.js for why this exists.
async function ensureSelectChoices(table, fieldName, values) {
  const field = table.getField(fieldName);
  if (!['singleSelect', 'multipleSelects'].includes(field.type)) return;
  const existingChoices = field.options.choices ?? [];
  const missingChoiceNames = missingSelectChoiceNames(existingChoices, values);
  if (!missingChoiceNames.length) return;
  await field.updateOptionsAsync({
    choices: [...existingChoices.map(c => ({ id: c.id, name: c.name })), ...missingChoiceNames.map(name => ({ name }))]
  });
  console.log(`⚠ ${fieldName}: added option(s) → ${missingChoiceNames.map(m => JSON.stringify(m)).join(', ')}`);
}

// ── run ────────────────────────────────────────────────────────────────
//
// IMPORTANT: Airtable disables ALL further writes in a script run once any
// single write fails. So the Sync Log row is created UP FRONT and filled in at
// the end. A log row left with blank counts means that run died partway.

const startedAt = new Date().toISOString();
const syncLogRecordId = await syncLogTable.createRecordAsync({ 'Script': { name: 'Transactions' }, 'Started At': startedAt });

// 1 ── Pull transactions inside the window
const transactedSince = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
let transactions = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const responseBody = await fetchFromGivebutter(
    `/transactions?scope=all&transactedAfter=${encodeURIComponent(transactedSince)}&page=${page}&per_page=100`
  );
  transactions.push(...(responseBody.data ?? []));
  const meta = responseBody.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) break;
  if (page === MAX_PAGES) console.log('⚠ Hit MAX_PAGES — narrow LOOKBACK_DAYS and re-run.');
}
console.log(`Fetched ${transactions.length} transactions since ${transactedSince.slice(0, 10)}`);
console.log('Statuses seen:', [...new Set(transactions.map(t => t.status))].map(v => JSON.stringify(v)).join(', '));

// 2 ── Index what Airtable already has
const memberQuery = await membersTable.selectRecordsAsync({
  fields: ['Contact ID', 'First Name', 'Last Name', 'Email']
});
const memberIdByContactId = new Map();
const memberFieldsByContactId = new Map();
for (const record of memberQuery.records) {
  const contactId = record.getCellValueAsString('Contact ID');
  if (!contactId) continue;
  memberIdByContactId.set(contactId, record.id);
  memberFieldsByContactId.set(contactId, {
    first: record.getCellValueAsString('First Name'),
    last:  record.getCellValueAsString('Last Name'),
    email: record.getCellValueAsString('Email')
  });
}

const transactionQuery = await transactionsTable.selectRecordsAsync({ fields: ['Transaction ID'] });
const transactionIdToRecordId = new Map(transactionQuery.records.map(record => [record.getCellValueAsString('Transaction ID'), record.id]));

// 3 ── One-time donors get a Member row too.
//      Membership Status will read "Lapsed / Donor" — they only become a
//      member when an active recurring plan shows up in the plans sync.
const membersToCreate = [], memberFieldGapsToFill = [];
const seenContactIds = new Set();

for (const transaction of transactions) {
  const contactId = transaction.contact_id == null ? '' : String(transaction.contact_id);
  if (!contactId || seenContactIds.has(contactId)) continue;
  seenContactIds.add(contactId);

  const { first, last } = nameParts(transaction);
  const email = toText(transaction.email ?? transaction.contact?.email);
  const phone = toText(transaction.phone ?? transaction.contact?.phone);

  if (!memberIdByContactId.has(contactId)) {
    memberIdByContactId.set(contactId, null);
    membersToCreate.push({ fields: { 'Contact ID': contactId, ...buildNewMemberFields(first, last, email, phone) } });
    continue;
  }

  // Fill blanks only — never overwrite what the plans sync established.
  // (Note: phone is deliberately omitted below, so a transaction never fills
  // a phone gap even though it captured one above for the new-member case.)
  const currentMemberFields = memberFieldsByContactId.get(contactId) ?? {};
  const changedMemberFields = fillMemberFieldGaps({ first, last, email }, currentMemberFields);
  if (Object.keys(changedMemberFields).length) memberFieldGapsToFill.push({ id: memberIdByContactId.get(contactId), fields: changedMemberFields });
}

for (let i = 0; i < membersToCreate.length; i += 50) {
  const newMemberBatch = membersToCreate.slice(i, i + 50);
  const createdMemberIds = await membersTable.createRecordsAsync(newMemberBatch);
  createdMemberIds.forEach((createdMemberId, index) => memberIdByContactId.set(newMemberBatch[index].fields['Contact ID'], createdMemberId));
}
for (let i = 0; i < memberFieldGapsToFill.length; i += 50) {
  await membersTable.updateRecordsAsync(memberFieldGapsToFill.slice(i, i + 50));
}
console.log(`Members created: ${membersToCreate.length}, gaps filled: ${memberFieldGapsToFill.length}`);

// 4 ── Widen the Status select to whatever Givebutter actually sent
await ensureSelectChoices(transactionsTable, 'Status', transactions.map(t => t.status));

// 5 ── Upsert the transactions
const syncedAt = new Date().toISOString();
const transactionsToCreate = [], transactionsToUpdate = [];

for (const transaction of transactions) {
  const transactionFields = buildNightlyTransactionFields(transaction, syncedAt);

  const memberRecordId = memberIdByContactId.get(transaction.contact_id == null ? '' : String(transaction.contact_id));
  if (memberRecordId) transactionFields['Member'] = [{ id: memberRecordId }];

  const existingTransactionId = transactionIdToRecordId.get(String(transaction.id));
  if (existingTransactionId) transactionsToUpdate.push({ id: existingTransactionId, fields: transactionFields });
  else transactionsToCreate.push({ fields: transactionFields });
}

for (let i = 0; i < transactionsToCreate.length; i += 50) await transactionsTable.createRecordsAsync(transactionsToCreate.slice(i, i + 50));
for (let i = 0; i < transactionsToUpdate.length; i += 50) await transactionsTable.updateRecordsAsync(transactionsToUpdate.slice(i, i + 50));

console.log(`Transactions — created ${transactionsToCreate.length}, updated ${transactionsToUpdate.length}`);

// 6 ── Close out the log row (only reached if everything above succeeded)
await syncLogTable.updateRecordAsync(syncLogRecordId, {
  'Records Created': transactionsToCreate.length + membersToCreate.length,
  'Records Updated': transactionsToUpdate.length + memberFieldGapsToFill.length
});
