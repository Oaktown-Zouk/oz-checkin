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

// null = pull everything. Set e.g. 3 for a fast nightly incremental once the
// first full pull is done — Givebutter filters server-side on updatedAfter.
const UPDATED_WITHIN_DAYS = null;

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

const toText = (value) => (value == null ? '' : String(value).trim());
const toDateOnly = (value) => (value ? String(value).slice(0, 10) : null);

// Givebutter types some booleans as strings; Boolean("false") is true.
const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
};

function flattenAddress(address) {
  if (!address) return '';
  return [
    [address.address_1, address.address_2].filter(Boolean).join(' '),
    [address.city, address.state].filter(Boolean).join(', '),
    [address.zipcode ?? address.zip, address.country].filter(Boolean).join(' ')
  ].map(s => toText(s)).filter(Boolean).join('\n');
}

function tagList(tags) {
  if (!tags) return '';
  if (Array.isArray(tags)) {
    return tags.map(tag => (typeof tag === 'string' ? tag : toText(tag?.name ?? tag?.label))).filter(Boolean).join(', ');
  }
  return toText(tags);
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

  const memberFields = {
    'Contact ID': contactId,
    'First Name': toText(contact.first_name ?? contact.preferred_name),
    'Last Name': toText(contact.last_name),
    'Email': toText(contact.primary_email ?? (contact.emails ?? [])[0]?.value).toLowerCase(),
    'Phone': toText(contact.primary_phone ?? (contact.phones ?? [])[0]?.value),
    'Tags': tagList(contact.tags),
    'Email Subscribed': toBoolean(contact.is_email_subscribed ?? contact.email_opt_in),
    'Phone Subscribed': toBoolean(contact.is_phone_subscribed ?? contact.sms_opt_in),
    'Contact Since': toDateOnly(contact.contact_since ?? contact.created_at),
    'Givebutter Total Given': Number(contact.stats?.total_contributions) || 0,
    'Address': flattenAddress(contact.primary_address ?? (contact.addresses ?? [])[0]),
    'Givebutter Note': toText(contact.note),
    'Archived in Givebutter': Boolean(contact.archived_at),
    'Contact Synced At': startedAt
  };

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
// 2. First run: leave UPDATED_WITHIN_DAYS = null for a full pull.
//
// 3. Then set it to 3 and schedule nightly at 3:30, after plans (3:00) and
//    transactions (3:15). Members must exist before contacts update them,
//    and a 3-day window covers any missed night.
//
// EXPECT THE TABLE TO GROW. This pulls everyone Givebutter knows, not just
// members — newsletter signups, event attendees, past donors. Every view
// that matters is already filtered (Active Members on Access Status, the
// dashboard on Active Memberships), so nothing downstream breaks. But
// "Members" will stop being a roster and start being a CRM.
// ═══════════════════════════════════════════════════════════════════════
