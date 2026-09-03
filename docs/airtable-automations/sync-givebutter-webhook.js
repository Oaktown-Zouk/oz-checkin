// ═══════════════════════════════════════════════════════════════════════
// GENERATED FILE — do not hand-edit.
//
// Source: server/airtable-automations/src/ (tested pure functions — see the
// *.test.ts files there for the edge cases these handle) and
// server/airtable-automations/bodies/ (this automation's own logic). Edit
// those, then run `npm run build:automations --workspace server` and paste
// the regenerated file into Airtable.
// ═══════════════════════════════════════════════════════════════════════

// text.ts
// Value coercion helpers shared by every Airtable Givebutter-sync automation.
// Pure, dependency-free -- see server/airtable-automations/README.md for why
// these live here instead of directly in the pasted-into-Airtable scripts.
function toText(value) {
    return value == null ? "" : String(value).trim();
}
function toDateOnly(value) {
    return value ? String(value).slice(0, 10) : null;
}
// Givebutter types some booleans as strings ("true"/"false"), and JS's own
// Boolean("false") is true -- a trap this function exists specifically to
// avoid.
function toBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (value == null)
        return false;
    return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
}
// Normalizes any value bound for a single select: trim it, and turn blanks
// into null. Trailing whitespace from an API is invisible in logs and will
// fail a select write even when the value looks identical to an existing
// choice.
function normalizeSelectText(value) {
    return value == null ? null : String(value).trim() || null;
}
// Single select WRITE format. The Scripting API wants {name: "..."} or
// {id: "..."} -- a bare string is rejected with "cannot accept the provided
// value", even when the choice exists verbatim.
function toSelectField(value) {
    const text = normalizeSelectText(value);
    return text ? { name: text } : null;
}

// givebutterParsing.ts
// Prefers real first/last fields. Falls back to splitting a combined name on
// the LAST space -- a heuristic that gets "Maria Delgado" right and "Ana van
// der Berg" wrong (returns "Ana van der" / "Berg"). The plans sync corrects
// any donor who later becomes a member, since /plans returns proper
// first_name / last_name.
function nameParts(source) {
    const first = toText(source.first_name ?? source.contact?.first_name);
    const last = toText(source.last_name ?? source.contact?.last_name);
    if (first || last)
        return { first, last };
    const fullName = toText(source.contact?.name ?? source.name);
    if (!fullName)
        return { first: "", last: "" };
    const nameSegments = fullName.split(/\s+/);
    return nameSegments.length === 1
        ? { first: fullName, last: "" }
        : { first: nameSegments.slice(0, -1).join(" "), last: nameSegments[nameSegments.length - 1] };
}
function tagList(tags) {
    if (!tags)
        return "";
    if (Array.isArray(tags)) {
        return tags
            .map((tag) => (typeof tag === "string" ? tag : toText(tag?.name ?? tag?.label)))
            .filter(Boolean)
            .join(", ");
    }
    return toText(tags);
}
function flattenAddress(address) {
    if (!address)
        return "";
    return [
        [address.address_1, address.address_2].filter(Boolean).join(" "),
        [address.city, address.state].filter(Boolean).join(", "),
        [address.zipcode ?? address.zip, address.country].filter(Boolean).join(" "),
    ]
        .map((s) => toText(s))
        .filter(Boolean)
        .join("\n");
}

// memberFields.ts
// Fields for a brand-new Member row created from a /plans or /transactions
// payload. NOT lowercased -- matches the nightly Plans and Transactions
// scripts' existing behavior. (The nightly Contacts script and the webhook
// script both DO lowercase email on create -- see
// buildNewMemberFieldsWithLowercaseEmail and buildContactMemberFields below.
// That inconsistency predates this refactor and isn't fixed here, since
// unifying it would change what four different scripts actually write.)
function buildNewMemberFields(first, last, email, phone) {
    return {
        "First Name": toText(first),
        "Last Name": toText(last),
        "Email": toText(email),
        "Phone": toText(phone),
    };
}
function buildNewMemberFieldsWithLowercaseEmail(first, last, email, phone) {
    return {
        "First Name": toText(first),
        "Last Name": toText(last),
        "Email": toText(email).toLowerCase(),
        "Phone": toText(phone),
    };
}
const FIELD_NAME_BY_KEY = {
    first: "First Name",
    last: "Last Name",
    email: "Email",
    phone: "Phone",
};
// Fills a currently-blank field on an existing Member from a fresh value --
// never overwrites something already there. Only considers whichever keys
// the caller actually passes in `incoming`: the nightly Transactions script
// omits `phone` here (even though it captures a phone number for the
// brand-new-member case above), so a transaction never fills a phone gap --
// that's existing, if surprising, behavior, not something this function
// decides on its own.
function fillMemberFieldGaps(incoming, current) {
    const changed = {};
    for (const key of Object.keys(incoming)) {
        const value = incoming[key];
        if (value && !current[key]) {
            changed[FIELD_NAME_BY_KEY[key]] = value;
        }
    }
    return changed;
}
// Overwrites a field only when the incoming value actually differs from
// what's there now -- used by the nightly Plans script to avoid churning
// every member's "last modified" timestamp on every run.
function diffMemberFields(incoming, current) {
    const changed = {};
    for (const key of Object.keys(incoming)) {
        const value = incoming[key];
        if (value && value !== current[key]) {
            changed[FIELD_NAME_BY_KEY[key]] = value;
        }
    }
    return changed;
}
// The nightly Contacts script's field set -- always written unconditionally
// (Givebutter is authoritative for all of these), unlike the gap-fill/diff
// functions above.
function buildContactMemberFields(contact, contactSyncedAt) {
    return {
        "Contact ID": toText(contact.id),
        "First Name": toText(contact.first_name ?? contact.preferred_name),
        "Last Name": toText(contact.last_name),
        "Email": toText(contact.primary_email ?? contact.emails?.[0]?.value).toLowerCase(),
        "Phone": toText(contact.primary_phone ?? contact.phones?.[0]?.value),
        "Tags": tagList(contact.tags),
        "Email Subscribed": toBoolean(contact.is_email_subscribed ?? contact.email_opt_in),
        "Phone Subscribed": toBoolean(contact.is_phone_subscribed ?? contact.sms_opt_in),
        "Contact Since": toDateOnly(contact.contact_since ?? contact.created_at),
        "Givebutter Total Given": Number(contact.stats?.total_contributions) || 0,
        "Address": flattenAddress(contact.primary_address ?? contact.addresses?.[0]),
        "Givebutter Note": toText(contact.note),
        "Archived in Givebutter": Boolean(contact.archived_at),
        "Contact Synced At": contactSyncedAt,
    };
}

// planFields.ts
// Shared by the nightly Plans script and the webhook -- both write the exact
// same field set for a Recurring Plan.
function buildRecurringPlanFields(plan, syncedAt) {
    return {
        "Plan ID": String(plan.id),
        "Status": toSelectField(plan.status),
        "Amount": Number(plan.amount) || 0,
        "Frequency": toSelectField(plan.frequency),
        "Method": toText(plan.method),
        "Fee Covered": Boolean(plan.fee_covered),
        "Start Date": toDateOnly(plan.start_at),
        "Next Bill Date": toDateOnly(plan.next_bill_date),
        "Canceled At": toDateOnly(plan.canceled_at),
        "Last Synced": syncedAt,
    };
}
// The three-way decision behind "default the beneficiary to the payer, but
// never overwrite a manual gift assignment" -- pulled out on its own because
// it was at the heart of the 2026-09-02 duplicate-Member incident (see
// README): two concurrent executions must resolve this identically given the
// same inputs, or Covers Member can end up split across two different Member
// rows.
function shouldAssignCoversMember(hasMemberRecordId, alreadyAssigned) {
    return hasMemberRecordId && !alreadyAssigned;
}
// Tiers must already be sorted richest-first by the caller; picks the first
// (highest) tier whose minimum price the amount still clears. Matches on
// AMOUNT, not tier name, since Tier Rule is itself derived from this match --
// matching by name would be circular.
function tierRuleForAmount(tierRules, amount) {
    if (!amount || amount <= 0)
        return null;
    return tierRules.find((rule) => amount >= rule.min) ?? null;
}
// null means no write is needed -- the link already points at the right
// place, including "correctly still empty" when no tier matches.
function tierRuleLinkFields(desiredTierRule, currentTierRuleId) {
    const desiredId = desiredTierRule?.id ?? null;
    if (desiredId === currentTierRuleId)
        return null;
    return { "Tier Rule": desiredTierRule ? [{ id: desiredTierRule.id }] : [] };
}

// transactionFields.ts
// One field set for both the nightly sync and the webhook -- the nightly sync used
// to write a narrower set (no Plan ID / Is Recurring / Refunded fields), which meant
// any transaction only ever nightly-synced was indistinguishable from a plain
// one-time drop-in even when it was really a recurring membership charge (Transactions
// is "disambiguated by Is Recurring + Plan ID presence" per docs/airtable-schema.md --
// a disambiguation that silently didn't work for most rows). Full parity closes that
// gap regardless of which sync path a given transaction happened to go through.
function buildTransactionFields(transaction, syncedAt) {
    return {
        "Transaction ID": String(transaction.id),
        "Amount": Number(transaction.amount) || 0,
        "Fee": Number(transaction.fee) || 0,
        "Donated": Number(transaction.donated) || 0,
        "Status": toSelectField(transaction.status),
        "Payment Method": toText(transaction.payment_method ?? transaction.method),
        "Campaign": toText(transaction.campaign?.title ?? transaction.campaign_code),
        "Transacted At": transaction.transacted_at ?? transaction.created_at ?? null,
        "Plan ID": toText(transaction.plan_id),
        "Is Recurring": Boolean(transaction.plan_id) || toBoolean(transaction.is_recurring),
        "Refunded": toBoolean(transaction.refunded) || Boolean(transaction.refunded_at),
        "Refunded At": toDateOnly(transaction.refunded_at),
        "Refunded Amount": Number(transaction.refunded_amount ?? 0) || 0,
        "Last Synced": syncedAt,
    };
}
// A transaction's Plan ID is Givebutter's own plan id (plain text, for matching/
// audit) -- this resolves that to the matching Recurring Plans row's Airtable
// record id, for the actual link field. `recurringPlanIdByPlanId` is a Plan ID ->
// Airtable record id map the caller builds once per run (nightly) or looks up
// per-event (webhook); returns null rather than an empty-array link patch when
// there's no Plan ID or no match yet -- a transaction can arrive before its plan has
// been synced, and leaving the link untouched (not forced empty) lets a later sync
// fill it in once the plan exists, instead of writing a wrong "no plan" answer.
function recurringPlanLinkField(planId, recurringPlanIdByPlanId) {
    if (!planId)
        return null;
    const recurringPlanRecordId = recurringPlanIdByPlanId.get(planId);
    if (!recurringPlanRecordId)
        return null;
    return { "Recurring Plans": [{ id: recurringPlanRecordId }] };
}

// selectChoices.ts
// Case-sensitive, exact-match against existing choice names. Airtable
// rejects a select write for any value not already in the choice list, so
// this is what decides whether a sync run needs to widen the field first.
function missingSelectChoiceNames(existingChoices, incomingValues) {
    const existingNames = new Set(existingChoices.map((choice) => choice.name));
    const missing = new Set();
    for (const value of incomingValues) {
        const text = normalizeSelectText(value);
        if (text && !existingNames.has(text))
            missing.add(text);
    }
    return [...missing];
}

// retry.ts
// Airtable's rate limit is 5 req/sec per base. maxAttempts=3 means up to 3
// retries after the initial attempt (4 tries total) -- matches
// server/src/airtable/realClient.ts's own retry budget, kept in sync by eye
// since the two can't share code (one runs in Node, one in Airtable's
// sandbox).
function shouldRetryAfterStatus(status, attempt, maxAttempts = 3) {
    return status === 429 && attempt < maxAttempts;
}
function retryDelayMs(attempt) {
    return 1000 * (attempt + 1);
}

// ── end of generated shared helpers — automation-specific logic below ───

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
// REQUIRES a "Recurring Plans" field on Transactions — a Link to another
// record field pointing at Recurring Plans — created by hand first;
// automations can't add fields.
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

  const transactionFields = buildTransactionFields(transaction, syncedAt);
  if (memberRecordId) transactionFields['Member'] = [{ id: memberRecordId }];

  // Same idea as the Covers Member lookup above: a transaction can arrive before
  // its plan has ever been synced (event ordering isn't guaranteed), in which case
  // there's nothing to link yet -- recurringPlanLinkField returns null rather than
  // an empty link, and the nightly Transactions sync fills it in once the plan
  // exists.
  const planIdText = toText(transaction.plan_id);
  if (planIdText) {
    const recurringPlanQuery = await recurringPlansTable.selectRecordsAsync({ fields: ['Plan ID'] });
    const recurringPlanRecord = recurringPlanQuery.records.find((record) => record.getCellValueAsString('Plan ID') === planIdText);
    if (recurringPlanRecord) transactionFields['Recurring Plans'] = [{ id: recurringPlanRecord.id }];
  }

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
