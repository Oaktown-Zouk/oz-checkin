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
// Givebutter → Airtable :: TRANSACTIONS  (payment history)
//
// Airtable → Automations → Trigger "At scheduled time" (daily, 3:15 AM PT)
//          → Action "Run a script"  ·  no input variables needed
//
// Rolling window, not a full pull — self-heals any gap shorter than
// LOOKBACK_DAYS. For the one-time historical backfill, set it to 3650,
// run manually, then set it back to 7 before enabling the schedule. (Also the
// way to backfill Plan ID / Is Recurring / Refunded* / the Recurring Plans
// link onto every existing transaction after adding those fields below — this
// script previously wrote none of them, so every already-synced row is
// missing them until a backfill run.)
//
// REQUIRES a "Recurring Plans" field on Transactions — a Link to another
// record field pointing at Recurring Plans — created by hand first;
// automations can't add fields.
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

const membersTable        = base.getTable('Members');
const recurringPlansTable = base.getTable('Recurring Plans');
const transactionsTable   = base.getTable('Transactions');
const syncLogTable        = base.getTable('Sync Log');

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

// For linking each transaction to its actual Recurring Plans record (not just the
// plain-text Plan ID) — see recurringPlanLinkField. Built once per run rather than
// per transaction, same as the other index maps above.
const recurringPlanQuery = await recurringPlansTable.selectRecordsAsync({ fields: ['Plan ID'] });
const recurringPlanIdByPlanId = new Map(recurringPlanQuery.records.map(record => [record.getCellValueAsString('Plan ID'), record.id]));

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
  const transactionFields = buildTransactionFields(transaction, syncedAt);

  const memberRecordId = memberIdByContactId.get(transaction.contact_id == null ? '' : String(transaction.contact_id));
  if (memberRecordId) transactionFields['Member'] = [{ id: memberRecordId }];

  const planLinkField = recurringPlanLinkField(transactionFields['Plan ID'], recurringPlanIdByPlanId);
  if (planLinkField) Object.assign(transactionFields, planLinkField);

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
