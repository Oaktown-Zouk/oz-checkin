// ═══════════════════════════════════════════════════════════════════════
// Givebutter webhook → Airtable, near-instant
//
//   Trigger: "When webhook received"
//   Action:  "Run a script"
//   Input variables (map after capturing a test payload — see setup below):
//       eventName   → the payload's event name, e.g. "transaction.succeeded"
//       resourceId  → the payload's data.id
//
// THIN WEBHOOK BY DESIGN. The payload is used only to learn *which* record
// changed; the record itself is then re-fetched from Givebutter. That means:
//   - we never depend on Givebutter's exact payload shape
//   - a replayed or out-of-order webhook can't write stale data
//   - a forged POST can at worst make us re-sync a record we already sync
// The last point matters because Airtable's webhook trigger has NO signature
// verification — anyone with the URL can call it.
//
// This runs in an AUTOMATION: fetch() works (no browser, no CORS), but
// updateOptionsAsync does not, so new select values must already exist.
//
// ── WHY THIS TALKS TO THE REST API INSTEAD OF base.getTable() ───────────
// Givebutter fires more than one webhook event for a single new signup (e.g.
// plan.created/plan.updated alongside the first transaction.succeeded), all
// carrying the same Contact ID. Airtable runs each webhook firing as its own
// independent script execution — nothing serializes them. An earlier version
// of this script used base.getTable(...).selectRecordsAsync() to check
// whether a Member with that Contact ID already existed, then
// createRecordAsync() if not. That's a read-then-write race with no lock
// between the two steps: two concurrent executions can both read "not
// found" and both create a row, producing two Members for one real person
// (this happened in production on 2026-09-02 — see this folder's README).
//
// You can't fix a read-then-write race by adding a lock record in Airtable —
// acquiring that lock is itself a read-then-write with the same race, just
// moved to a different table. The only real fix is to stop deciding
// existence in script code at all, and hand that decision to Airtable's own
// backend, which the REST API does atomically via `performUpsert`. Two
// concurrent upserts on the same Contact ID cannot both create a row — one
// creates, the other necessarily updates the row the first one just made. So
// every find-or-create in this script goes through upsertAirtableRecord()
// below instead of selectRecordsAsync()+createRecordAsync().
// ═══════════════════════════════════════════════════════════════════════

const GIVEBUTTER_API_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY'; // ← Settings → Integrations → API Keys — fill in only inside Airtable's own script editor, never commit the real value here
const GIVEBUTTER_API_BASE = 'https://api.givebutter.com/v1';

// Dedicated PAT, scoped to data.records:read + data.records:write on THIS
// base only — deliberately separate from the app server's own AIRTABLE_PAT
// (server/.env) so this script's blast radius is limited to what it actually
// needs, and so it's not a second copy of a credential something else already
// depends on.
const AIRTABLE_PAT = 'REPLACE_WITH_DEDICATED_PAT';
const AIRTABLE_BASE_ID = base.id;

const { eventName, resourceId } = input.config();

const membersTable        = base.getTable('Members');
const recurringPlansTable = base.getTable('Recurring Plans');
const transactionsTable   = base.getTable('Transactions');
const syncLogTable        = base.getTable('Sync Log');

async function fetchFromGivebutter(path) {
  const response = await fetch(`${GIVEBUTTER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GIVEBUTTER_API_KEY}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Givebutter ${response.status} on ${path}: ${await response.text()}`);
  const body = await response.json();
  return body.data ?? body;
}

// Running totals for the Sync Log row — every upsert reports whether it
// created or updated so the log reflects real REST-API outcomes rather than
// a guess.
let recordsCreated = 0;
let recordsUpdated = 0;

// Atomic find-or-create/update, keyed on fieldsToMergeOn — this is what
// closes the race that selectRecordsAsync()+createRecordAsync() can't.
// Airtable does the existence check and the write as one server-side
// operation; if more than one existing record already matches the key it
// errors instead of guessing, which is exactly what should happen rather
// than silently picking one.
async function upsertAirtableRecord(tableId, fieldsToMergeOn, recordFields, attempt = 0) {
  const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn },
      records: [{ fields: recordFields }]
    })
  });

  if (shouldRetryAfterStatus(response.status, attempt)) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    return upsertAirtableRecord(tableId, fieldsToMergeOn, recordFields, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Airtable upsert ${response.status} on ${tableId}: ${await response.text()}`);
  }

  const body = await response.json();
  const record = body.records[0]; // { id, fields, createdTime }
  const wasCreated = (body.createdRecords ?? []).includes(record.id);
  if (wasCreated) recordsCreated++; else recordsUpdated++;
  return { id: record.id, created: wasCreated };
}

async function upsertMemberByContactId(contactId, firstName, lastName, email, phone) {
  const contactIdText = toText(contactId);
  if (!contactIdText) return null;

  // Read only to decide WHICH FIELD VALUES to send — never to decide
  // whether a row exists. A stale read here can at worst redundantly fill
  // an already-filled gap, or (if this read raced another execution's
  // create) send create-shaped fields into what turns out to be an update.
  // Either outcome just rewrites a field to what is, in practice, the same
  // Givebutter value the other execution already wrote — never a second
  // row, because upsertAirtableRecord is what decides existence, atomically.
  const memberQuery = await membersTable.selectRecordsAsync({ fields: ['Contact ID', 'First Name', 'Last Name'] });
  const existingMemberRecord = memberQuery.records.find((record) => record.getCellValueAsString('Contact ID') === contactIdText);

  const memberFields = { 'Contact ID': contactIdText };
  if (existingMemberRecord) {
    Object.assign(
      memberFields,
      fillMemberFieldGaps(
        { first: toText(firstName), last: toText(lastName) },
        { first: existingMemberRecord.getCellValueAsString('First Name'), last: existingMemberRecord.getCellValueAsString('Last Name') }
      )
    );
  } else {
    Object.assign(memberFields, buildNewMemberFieldsWithLowercaseEmail(firstName, lastName, email, phone));
  }

  const upserted = await upsertAirtableRecord(membersTable.id, ['Contact ID'], memberFields);
  return upserted.id;
}

// ── run ────────────────────────────────────────────────────────────────
//
// Same convention as the three nightly scripts: the Sync Log row is created
// UP FRONT, before any real work, and filled in at the end. A log row left
// with blank counts means this run died partway — check the automation's
// run history for the actual error. (An earlier version of this script never
// logged at all, which is part of what made the 2026-09-02 incident hard to
// diagnose — there was no record it had even run.)
const startedAt = new Date().toISOString();
const syncLogRecordId = await syncLogTable.createRecordAsync({ 'Script': { name: 'Webhook' }, 'Started At': startedAt });

const eventType = toText(eventName);
const syncedAt = new Date().toISOString();

console.log(`Webhook received for ${eventType}`);

if (!resourceId) {
  throw new Error(`No resourceId in payload for event "${eventType}" — re-check the input variable mapping.`);
}

if (eventType.startsWith('plan.')) {
  const plan = await fetchFromGivebutter(`/plans/${resourceId}`);
  const memberRecordId = await upsertMemberByContactId(plan.contact_id, plan.first_name, plan.last_name, plan.email, plan.phone);

  const planFields = buildRecurringPlanFields(plan, syncedAt);
  if (memberRecordId) planFields['Member'] = [{ id: memberRecordId }];

  // Default the beneficiary to the payer, but never overwrite a gift
  // assignment someone made by hand. This read can still race a concurrent
  // webhook for the same plan — but memberRecordId is now the same
  // atomically-resolved Member row for both racers (see
  // upsertMemberByContactId above), so both sides of the race write the
  // same Covers Member value instead of two different ones. The plan row
  // itself can't split into two rows either, since the upsert below is
  // keyed on Plan ID the same way.
  const existingPlanQuery = await recurringPlansTable.selectRecordsAsync({ fields: ['Plan ID', 'Covers Member'] });
  const existingPlanRecord = existingPlanQuery.records.find((record) => record.getCellValueAsString('Plan ID') === String(plan.id));
  const coversMemberAlreadyAssigned = Boolean(existingPlanRecord && (existingPlanRecord.getCellValue('Covers Member') ?? []).length > 0);
  if (shouldAssignCoversMember(Boolean(memberRecordId), coversMemberAlreadyAssigned)) {
    planFields['Covers Member'] = [{ id: memberRecordId }];
  }

  try {
    await upsertAirtableRecord(recurringPlansTable.id, ['Plan ID'], planFields);
  } catch (e) {
    console.log(`Failed to upsert ${recurringPlansTable.name} with ${JSON.stringify(planFields)}`);
    throw e;
  }
  console.log(`${eventType} → plan ${plan.id} (${plan.status}) synced`);

} else if (eventType.startsWith('transaction.') || eventType.startsWith('refund.')) {
  const transaction = await fetchFromGivebutter(`/transactions/${resourceId}`);
  const memberRecordId = await upsertMemberByContactId(
    transaction.contact_id, transaction.first_name, transaction.last_name,
    transaction.email ?? transaction.contact?.email, transaction.phone ?? transaction.contact?.phone
  );

  const transactionFields = buildWebhookTransactionFields(transaction, syncedAt);
  if (memberRecordId) transactionFields['Member'] = [{ id: memberRecordId }];

  await upsertAirtableRecord(transactionsTable.id, ['Transaction ID'], transactionFields);
  console.log(`${eventType} → transaction ${transaction.id} ($${transaction.amount}, ${transaction.plan_id ? 'membership' : 'drop-in'}) synced`);

} else if (eventType === 'contact.created') {
  const contact = await fetchFromGivebutter(`/contacts/${resourceId}`);
  await upsertMemberByContactId(contact.id, contact.first_name, contact.last_name, contact.primary_email ?? contact.email, contact.primary_phone ?? contact.phone);
  console.log(`contact ${contact.id} synced`);

} else {
  console.log(`Ignoring event: ${eventType}`);
}

// Closed out last, only reached if everything above succeeded — same
// contract as the three nightly scripts (see their own comment on this).
await syncLogTable.updateRecordAsync(syncLogRecordId, {
  'Records Created': recordsCreated,
  'Records Updated': recordsUpdated
});

// ═══════════════════════════════════════════════════════════════════════
// SETUP
//
// 1. Add "Webhook" as a choice on Sync Log ▸ Script — automations can't add
//    select options, so do this by hand first or the log write fails.
//
// 2. Airtable → account → Personal access tokens → new token, named for
//    this automation. Scopes: data.records:read, data.records:write.
//    Access: this base only. Paste the value into AIRTABLE_PAT above.
//
// 3. Automations → new automation → trigger "When webhook received".
//    Copy the generated URL. Leave the automation OFF for now.
//
// 4. Register it with Givebutter (webhooks are API-only there). From a
//    terminal, once:
//
//    curl -X POST https://api.givebutter.com/v1/webhooks \
//      -H "Authorization: Bearer YOUR_GIVEBUTTER_API_KEY" \
//      -H "Content-Type: application/json" \
//      -d '{
//        "name": "Airtable live sync",
//        "url": "YOUR_AIRTABLE_WEBHOOK_URL",
//        "events": ["transaction.succeeded","refund.created",
//                   "plan.created","plan.updated","plan.canceled",
//                   "plan.paused","plan.resumed","plan.failed",
//                   "contact.created"],
//        "enabled": true
//      }'
//
// 5. Back in the trigger config, click Test and make a real $1 transaction
//    (or resume/pause a plan). Airtable captures the live payload and shows
//    you its field paths.
//
// 6. Add the two input variables to the script action, mapping them to
//    whatever the captured payload actually calls them — most likely
//    `event` and `data.id`.
//
// 7. Turn the automation ON.
//
// KEEP THE NIGHTLY SYNCS. Webhooks get missed — a deploy, an outage, a
// dropped delivery. The 3am runs are the reconciliation pass that makes
// missed events self-healing. This just means you don't wait until 3am.
// ═══════════════════════════════════════════════════════════════════════
