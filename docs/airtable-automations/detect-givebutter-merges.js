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
// Givebutter → Airtable :: MERGE DETECTION
//
// Merging two contacts in Givebutter's UI deletes the losing contact: it
// drops out of /contacts and GET /contacts/{id} 404s, with no pointer to the
// contact it was merged into. This script finds Members in that state and:
//
//   - ticks "Removed From Givebutter" (only after its own GET confirms 404)
//   - sets "Duplicate Of" when the Member's email belongs to exactly one live
//     contact, and that contact has a Member. Anything else is left for
//     manual review: filter Members on Removed From Givebutter + empty
//     Duplicate Of.
//
// Setting Duplicate Of is all this does. Moving check-ins, levels, etc. onto
// the surviving Member is merge-duplicate-member.js's job, triggered by
// Duplicate Of being filled -- by this script or by hand.
//
// A Member flagged earlier whose contact shows up again (and has no
// Duplicate Of yet) gets the flag cleared.
//
// Runs in EITHER context:
//   - Scheduled automation, nightly at 3:45 (after contacts at 3:30)
//   - Scripting extension, ad hoc right after merging contacts in Givebutter
// ═══════════════════════════════════════════════════════════════════════

const GIVEBUTTER_API_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY'; // ← Settings → Integrations → API Keys — fill in only inside Airtable's own script editor, never commit the real value here
const GIVEBUTTER_API_BASE = 'https://api.givebutter.com/v1';
const MAX_PAGES = 40;                  // 40 × 100 = 4,000 contacts per run

// A real night's merges are a handful. More than this vanishing at once
// points at a bad pull (wrong key, API hiccup), so the run stops untouched.
const MAX_VANISHED_PER_RUN = 15;

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
// Tier Rule used to be maintained here (off a member's pledged Membership Amount),
// but that clobbered a paused/canceled member's tier early -- Membership Amount
// goes blank with no active plan to read it from, even though they may have paid
// within the last 30 days and have plenty of time left on what they paused. Tier
// assignment now lives entirely in its own Airtable automation, keyed off actual
// payments in the last 30 days via formula/rollup fields -- see
// docs/airtable-automations/assign-member-tier.js and docs/airtable-schema.md's
// "Tier Rule" section. This sync no longer touches Tier Rule at all.

// transactionFields.ts
// The NOTAFLOF ("none turned away for lack of funds") drop-in campaign's own
// checkout question -- its pay-what-you-can amount can't be used to infer a class
// count the way a regular drop-in's fixed sliding-scale price can, so its widget
// asks the student directly. There's a separate NOTAFLOF campaign for memberships
// too, which doesn't ask this at all -- matched by campaign below so only the
// drop-in campaign's transactions ever get a value here, which is also easier for a
// human scanning the table to make sense of than a column that's sometimes
// meaningful and sometimes not.
const NOTAFLOF_DROPINS_CAMPAIGN = "ZROVNN";
const CLASSES_CUSTOM_FIELD_TITLE = "how many classes are you paying for?";
// Matched case-insensitively since Givebutter form text is edited by hand and
// whitespace/casing drift is cheap to shrug off; the digits are pulled out of the
// answer rather than requiring an exact "1"/"2" so a value like "2 classes" still
// parses.
function classesRequestedFromCustomFields(customFields) {
    if (!Array.isArray(customFields))
        return null;
    const field = customFields.find((entry) => typeof entry?.title === "string" && entry.title.trim().toLowerCase() === CLASSES_CUSTOM_FIELD_TITLE);
    if (!field)
        return null;
    const match = String(field.value ?? "").match(/\d+/);
    if (!match)
        return null;
    const parsed = Number(match[0]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
// null for every transaction except the NOTAFLOF drop-in campaign's own -- see
// NOTAFLOF_DROPINS_CAMPAIGN above for why this is deliberately narrower than "any
// transaction with a matching custom field".
function notaflofCreditsRequested(transaction, campaign) {
    if (campaign !== NOTAFLOF_DROPINS_CAMPAIGN)
        return null;
    return classesRequestedFromCustomFields(transaction.custom_fields);
}
// One field set for both the nightly sync and the webhook -- the nightly sync used
// to write a narrower set (no Plan ID / Is Recurring / Refunded fields), which meant
// any transaction only ever nightly-synced was indistinguishable from a plain
// one-time drop-in even when it was really a recurring membership charge (Transactions
// is "disambiguated by Is Recurring + Plan ID presence" per docs/airtable-schema.md --
// a disambiguation that silently didn't work for most rows). Full parity closes that
// gap regardless of which sync path a given transaction happened to go through.
function buildTransactionFields(transaction, syncedAt) {
    // Real API responses always carry exactly one entry here (confirmed against
    // live data) -- a transaction with no nested entry at all would mean
    // Givebutter changed this shape, not a genuine zero-payment transaction, so
    // falling back to an empty object (refunded/refunded_at both undefined,
    // same as "not refunded") is the safe default rather than throwing.
    const subTransaction = transaction.transactions?.[0] ?? {};
    const campaign = toText(transaction.campaign?.title ?? transaction.campaign_code);
    return {
        "Transaction ID": String(transaction.id),
        "Amount": Number(transaction.amount) || 0,
        "Fee": Number(transaction.fee) || 0,
        "Donated": Number(transaction.donated) || 0,
        "Status": toSelectField(transaction.status),
        "Payment Method": toText(transaction.payment_method ?? transaction.method),
        "Campaign": campaign,
        "NOTAFLOF Credits Requeested": notaflofCreditsRequested(transaction, campaign),
        "Transacted At": transaction.transacted_at ?? transaction.created_at ?? null,
        "Plan ID": toText(transaction.plan_id),
        "Is Recurring": Boolean(transaction.plan_id) || toBoolean(transaction.is_recurring),
        "Refunded": toBoolean(subTransaction.refunded) || Boolean(subTransaction.refunded_at),
        "Refunded At": toDateOnly(subTransaction.refunded_at),
        // Refunded Amount is deliberately NOT written here. Givebutter never reports a
        // refunded dollar amount anywhere on this object (only the boolean + timestamp
        // above), and this field's own description in Airtable says it "falls back to
        // the modelled 50%" when absent -- a fallback a staffer fills in by hand once a
        // refund is processed. Every write here is a partial update (both the REST PATCH
        // and the Scripting SDK leave an omitted field untouched), so leaving this key
        // out entirely lets that value stick instead of being forced back to 0 on every
        // sync run, which is what writing 0 here used to do.
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

// rebateEligibility.ts
// Decides what (if anything) to write once a Transactions record's own qualifying
// fields (Is Recurring, Status, Amount, Transacted At) are already in place and its
// own "Recurring Payment Key" formula has picked up the change. Reuses that field and
// Members."First Recurring Key" (both pre-existing Airtable formula/rollup fields --
// see docs/airtable-schema.md's "Rebates" section) rather than re-deriving "is this
// the member's first recurring payment" from scratch: First Recurring Key is already
// the MIN of every one of the member's qualifying transactions' keys, so this
// transaction IS the first iff its own key equals it.
//
// currentRebateStatus gates the Member write specifically: only ever transitions
// Rebate Status away from its untouched state (blank or "New") once -- a status
// that's already progressed further (Refund Requested, Refund Processed, ...) is
// left alone, matching Rebate Owed's own documented policy of never retroactively
// changing what someone was owed. The Transaction write has no such guard -- the
// same one row will always be the member's first, forever, so re-marking it "50%" on
// a later run is a harmless no-op, not a drift risk.
function decideRebateUpdate(transactionRecurringPaymentKey, memberFirstRecurringKey, currentRebateStatus) {
    const isFirstPayment = transactionRecurringPaymentKey != null &&
        memberFirstRecurringKey != null &&
        transactionRecurringPaymentKey === memberFirstRecurringKey;
    if (!isFirstPayment) {
        return { markTransactionRebateEligible: false, markMemberRefundEligible: false };
    }
    const untouched = !currentRebateStatus || currentRebateStatus === "New";
    return { markTransactionRebateEligible: true, markMemberRefundEligible: untouched };
}

// mergeDetection.ts
// Every address a contact is reachable at, lowercased and de-duplicated.
function contactEmails(contact) {
    const all = [contact.primary_email, ...(contact.emails ?? []).map((e) => e?.value)]
        .map((e) => toText(e).toLowerCase())
        .filter(Boolean);
    return [...new Set(all)];
}
// email → ids of every live contact carrying that email.
function indexContactIdsByEmail(contacts) {
    const index = new Map();
    for (const contact of contacts) {
        const contactId = toText(contact.id);
        if (!contactId)
            continue;
        for (const email of contactEmails(contact)) {
            index.set(email, [...(index.get(email) ?? []), contactId]);
        }
    }
    return index;
}
function splitVanishedMembers(members, liveContactIds) {
    const newlyVanished = [];
    const reappeared = [];
    for (const member of members) {
        if (!member.contactId)
            continue;
        const live = liveContactIds.has(member.contactId);
        if (!live && !member.removedFromGivebutter)
            newlyVanished.push(member);
        if (live && member.removedFromGivebutter && !member.hasDuplicateOf)
            reappeared.push(member);
    }
    return { newlyVanished, reappeared };
}
// The Member a vanished Member was most likely merged into: the one whose
// contact is the ONLY live contact carrying the vanished Member's email.
// Returns null when there's no email, no match, several matches, or the match
// is the vanished Member itself -- all of which are left for manual review.
function survivorMemberId(vanished, contactIdsByEmail, memberIdByContactId) {
    const email = toText(vanished.email).toLowerCase();
    if (!email)
        return null;
    const contactIds = contactIdsByEmail.get(email) ?? [];
    if (contactIds.length !== 1)
        return null;
    const memberId = memberIdByContactId.get(contactIds[0]);
    if (!memberId || memberId === vanished.id)
        return null;
    return memberId;
}

// ── end of generated shared helpers — automation-specific logic below ───

const membersTable = base.getTable('Members');
const syncLogTable = base.getTable('Sync Log');

// Extension runs in a browser (CORS); automations don't. Pick what exists.
const httpGet = (typeof remoteFetchAsync === 'function') ? remoteFetchAsync : fetch;

function givebutterRequest(path) {
  return httpGet(`${GIVEBUTTER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GIVEBUTTER_API_KEY}`, Accept: 'application/json' }
  });
}

async function fetchFromGivebutter(path) {
  const response = await givebutterRequest(path);
  if (!response.ok) throw new Error(`Givebutter ${response.status} on ${path}: ${await response.text()}`);
  return response.json();
}

// true = confirmed gone (404), false = still there. Anything else throws.
async function contactIsGone(contactId) {
  const path = `/contacts/${encodeURIComponent(contactId)}`;
  const response = await givebutterRequest(path);
  if (response.status === 404) return true;
  if (response.ok) return false;
  throw new Error(`Givebutter ${response.status} on ${path}: ${await response.text()}`);
}

// ── run ────────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
const syncLogRecordId = await syncLogTable.createRecordAsync({ 'Script': { name: 'Merges' }, 'Started At': startedAt });

// 1 ── Full pull of live contacts (no updatedAfter: absence is the signal)
const contacts = [];
let pulledEveryPage = false;
for (let page = 1; page <= MAX_PAGES; page++) {
  const responseBody = await fetchFromGivebutter(`/contacts?per_page=100&page=${page}`);
  contacts.push(...(responseBody.data ?? []));
  const meta = responseBody.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) { pulledEveryPage = true; break; }
}
if (!pulledEveryPage) throw new Error('Hit MAX_PAGES before the last page — raise it; a partial pull would flag live contacts.');
console.log(`Fetched ${contacts.length} live contacts`);

const liveContactIds = new Set(contacts.map(c => toText(c.id)).filter(Boolean));
const contactIdsByEmail = indexContactIdsByEmail(contacts);

// 2 ── Members
// The primary field is what fills record.name for the log lines below.
const memberQuery = await membersTable.selectRecordsAsync({
  fields: ['Member', 'Contact ID', 'Email', 'Removed From Givebutter', 'Duplicate Of']
});
const members = memberQuery.records.map(record => ({
  id: record.id,
  name: record.name,
  contactId: record.getCellValueAsString('Contact ID'),
  email: record.getCellValueAsString('Email'),
  removedFromGivebutter: !!record.getCellValue('Removed From Givebutter'),
  hasDuplicateOf: (record.getCellValue('Duplicate Of') ?? []).length > 0,
}));
const memberIdByContactId = new Map(members.filter(m => m.contactId).map(m => [m.contactId, m.id]));

const { newlyVanished, reappeared } = splitVanishedMembers(members, liveContactIds);
if (newlyVanished.length > MAX_VANISHED_PER_RUN) {
  throw new Error(`${newlyVanished.length} Members vanished at once (limit ${MAX_VANISHED_PER_RUN}) — check the pull before trusting it.`);
}

// 3 ── Confirm each vanished contact is really gone, then match by email
const updates = [];
let matched = 0;
for (const member of newlyVanished) {
  if (!(await contactIsGone(member.contactId))) {
    console.log(`${member.name}: contact ${member.contactId} missing from the list but still fetchable; skipped`);
    continue;
  }
  const fields = { 'Removed From Givebutter': true };
  const survivorId = member.hasDuplicateOf ? null : survivorMemberId(member, contactIdsByEmail, memberIdByContactId);
  if (survivorId) {
    fields['Duplicate Of'] = [{ id: survivorId }];
    matched++;
    console.log(`${member.name}: contact ${member.contactId} gone → Duplicate Of ${memberQuery.getRecord(survivorId).name}`);
  } else {
    console.log(`${member.name}: contact ${member.contactId} gone → needs manual review`);
  }
  updates.push({ id: member.id, fields });
}
for (const member of reappeared) {
  console.log(`${member.name}: contact ${member.contactId} is live again → flag cleared`);
  updates.push({ id: member.id, fields: { 'Removed From Givebutter': false } });
}

for (let i = 0; i < updates.length; i += 50) await membersTable.updateRecordsAsync(updates.slice(i, i + 50));

console.log(`Merges — flagged ${updates.length - reappeared.length} (${matched} matched), cleared ${reappeared.length}`);

await syncLogTable.updateRecordAsync(syncLogRecordId, {
  'Records Created': 0,
  'Records Updated': updates.length
});

// ═══════════════════════════════════════════════════════════════════════
// SETUP
//
// 1. Add "Merges" as a choice on Sync Log ▸ Script — automations can't add
//    select options, so do this by hand first or the log write fails.
//
// 2. Schedule nightly at 3:45, after contacts (3:30), so a contact created
//    and merged on the same day already has its Member.
// ═══════════════════════════════════════════════════════════════════════
