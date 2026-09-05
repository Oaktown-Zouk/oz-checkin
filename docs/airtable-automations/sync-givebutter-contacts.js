// ═══════════════════════════════════════════════════════════════════════
// GENERATED FILE — do not hand-edit.
//
// Source: server/airtable-automations/src/ (tested pure functions — see the
// *.test.ts files there for the edge cases these handle) and
// server/airtable-automations/bodies/ (this automation's own logic). Edit
// those, then run `npm run build:automations --workspace server` and paste
// the regenerated file into Airtable.
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// Givebutter → Airtable :: CONTACTS
//
// Brings the whole Givebutter CRM into Members. Anyone with no plan and no
// giving lands as "Prospect", which is already what that status means.
//
// Runs in EITHER context:
//   - Scheduled automation, nightly at 3:30 (after plans and transactions)
//   - Scripting extension, for a manual full pull
//
// Safe to re-run: keyed on Contact ID.
//
// ── WHAT IT WILL AND WON'T OVERWRITE ────────────────────────────────────
// Givebutter is authoritative for name, email, phone and the CRM fields —
// those are overwritten. It never touches:
//   - Notes            (yours; Givebutter's note goes to "Givebutter Note")
//   - Rebate Status    (a lifecycle you manage; overwriting would re-grant
//                       the first-time discount)
//   - Covers Member    (gift assignments)
//   - Members with a BLANK Contact ID — hand-made people are never matched,
//     so they're invisible to this script by construction.
// ═══════════════════════════════════════════════════════════════════════

const GIVEBUTTER_API_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY'; // ← Settings → Integrations → API Keys — fill in only inside Airtable's own script editor, never commit the real value here
const GIVEBUTTER_API_BASE = 'https://api.givebutter.com/v1';
const MAX_PAGES = 40;                  // 40 × 100 = 4,000 contacts per run

// null = pull everything. Set e.g. 7 for a fast nightly incremental once the
// first full pull is done — Givebutter filters server-side on updatedAfter.
const UPDATED_WITHIN_DAYS = 7;

// ── shared helpers (generated — edit server/airtable-automations/src/) ──

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
// Single select WRITE format for the Scripting SDK (table.createRecordAsync /
// updateRecordAsync, used by the nightly scripts) -- {name: "..."} or
// {id: "..."}; a bare string is rejected with "cannot accept the provided
// value", even when the choice exists verbatim.
//
// This is SDK-specific, not universal: Airtable's REST API wants the
// opposite -- a plain string -- and rejects this {name} shape outright, even
// for a real, existing choice (see restFields.ts's toRestFields, and the
// 2026-09-03 webhook incident in docs/airtable-automations/CHANGELOG.md). Any
// REST-based write (the webhook's upsertAirtableRecord) must run its fields
// through toRestFields() after building them with this -- it isn't safe to
// send this shape to REST as-is.
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

// restFields.ts
// The field-builders (planFields.ts, transactionFields.ts, and every call
// site in the webhook body that sets a link field directly, e.g.
// `fields['Member'] = [{ id: memberRecordId }]`) produce the Scripting SDK's
// cell-value shapes -- correct for the nightly scripts' own
// table.createRecordsAsync()/updateRecordsAsync() calls, but wrong for a raw
// REST API write. Two shapes differ, both confirmed against real 422s during
// the 2026-09-03 webhook incident (see docs/airtable-automations/CHANGELOG.md):
//   - single select: SDK wants {name: "..."}; REST wants a plain string, and
//     rejects the object with "Cannot parse value for field X" even for a
//     real, existing choice.
//   - linked record: SDK wants [{id: "recXXX"}]; REST wants a plain array of
//     id strings (["recXXX"]), and rejects the object form with
//     "INVALID_RECORD_ID" / `Value "[object Object]" is not a valid record
//     ID.` -- the object stringifies to that when REST tries to parse it as
//     an id.
// This adapts a fields object built for the Scripting SDK into REST-safe form
// right before a REST write, without changing what the shared builders
// themselves produce -- they stay correct for the nightly scripts, which
// never touch this function.
function toRestFields(fields) {
    const converted = {};
    for (const [key, value] of Object.entries(fields)) {
        if (isSelectCellValue(value)) {
            converted[key] = value.name;
        }
        else if (isLinkCellArray(value)) {
            converted[key] = value.map((link) => link.id);
        }
        else {
            converted[key] = value;
        }
    }
    return converted;
}
function isSelectCellValue(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "name" in value &&
        Object.keys(value).length === 1);
}
function isLinkCellArray(value) {
    return (Array.isArray(value) &&
        value.every((item) => typeof item === "object" && item !== null && typeof item.id === "string"));
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

const membersTable = base.getTable('Members');
const syncLogTable = base.getTable('Sync Log');

// Extension runs in a browser (CORS); automations don't. Pick what exists.
const httpGet = (typeof remoteFetchAsync === 'function') ? remoteFetchAsync : fetch;

async function fetchFromGivebutter(path) {
  const response = await httpGet(`${GIVEBUTTER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GIVEBUTTER_API_KEY}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Givebutter ${response.status} on ${path}: ${await response.text()}`);
  return response.json();
}

// ── run ────────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
const syncLogRecordId = await syncLogTable.createRecordAsync({ 'Script': { name: 'Contacts' }, 'Started At': startedAt });

// 1 ── Pull contacts
let queryParams = 'per_page=100';
if (UPDATED_WITHIN_DAYS) {
  const updatedSince = new Date(Date.now() - UPDATED_WITHIN_DAYS * 86400000).toISOString();
  queryParams += `&updatedAfter=${encodeURIComponent(updatedSince)}`;
}

let contacts = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const responseBody = await fetchFromGivebutter(`/contacts?${queryParams}&page=${page}`);
  contacts.push(...(responseBody.data ?? []));
  const meta = responseBody.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) break;
  if (page === MAX_PAGES) console.log('⚠ Hit MAX_PAGES — some contacts were not fetched.');
}
console.log(`Fetched ${contacts.length} contacts`);

// 2 ── Index what we already have
const memberQuery = await membersTable.selectRecordsAsync({ fields: ['Contact ID'] });
const memberIdByContactId = new Map(
  memberQuery.records
    .filter(record => record.getCellValueAsString('Contact ID'))
    .map(record => [record.getCellValueAsString('Contact ID'), record.id])
);

// 3 ── Build the writes
const membersToCreate = [], membersToUpdate = [];

for (const contact of contacts) {
  const contactId = toText(contact.id);
  if (!contactId) continue;

  const memberFields = buildContactMemberFields(contact, startedAt);

  const existingMemberId = memberIdByContactId.get(contactId);
  if (existingMemberId) membersToUpdate.push({ id: existingMemberId, fields: memberFields });
  else membersToCreate.push({ fields: memberFields });
}

for (let i = 0; i < membersToCreate.length; i += 50) await membersTable.createRecordsAsync(membersToCreate.slice(i, i + 50));
for (let i = 0; i < membersToUpdate.length; i += 50) await membersTable.updateRecordsAsync(membersToUpdate.slice(i, i + 50));

console.log(`Contacts — created ${membersToCreate.length}, updated ${membersToUpdate.length}`);

await syncLogTable.updateRecordAsync(syncLogRecordId, {
  'Records Created': membersToCreate.length,
  'Records Updated': membersToUpdate.length
});

// ═══════════════════════════════════════════════════════════════════════
// SETUP
//
// 1. Add "Contacts" as a choice on Sync Log ▸ Script — automations can't
//    add select options, so do this by hand first or the log write fails.
//
// 2. First run: set UPDATED_WITHIN_DAYS = null for a full pull.
//
// 3. Then set it to 7 (the current default here) and schedule nightly at
//    3:30, after plans (3:00) and transactions (3:15). Members must exist
//    before contacts update them, and a 7-day window comfortably covers a
//    missed night or two.
//
// EXPECT THE TABLE TO GROW. This pulls everyone Givebutter knows, not just
// members — newsletter signups, event attendees, past donors. Every view
// that matters is already filtered (Active Members on Access Status, the
// dashboard on Active Memberships), so nothing downstream breaks. But
// "Members" will stop being a roster and start being a CRM.
// ═══════════════════════════════════════════════════════════════════════
