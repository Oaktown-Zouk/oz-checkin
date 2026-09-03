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

const GB_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY';
const GB_BASE = 'https://api.givebutter.com/v1';
const MAX_PAGES = 40;                  // 40 × 100 = 4,000 contacts per run

// null = pull everything. Set e.g. 3 for a fast nightly incremental once the
// first full pull is done — Givebutter filters server-side on updatedAfter.
const UPDATED_WITHIN_DAYS = null;

const membersTbl = base.getTable('Members');
const logTbl     = base.getTable('Sync Log');

// Extension runs in a browser (CORS); automations don't. Pick what exists.
const httpGet = (typeof remoteFetchAsync === 'function') ? remoteFetchAsync : fetch;

async function gb(path) {
  const res = await httpGet(`${GB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GB_KEY}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Givebutter ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

const str = (v) => (v == null ? '' : String(v).trim());
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

// Givebutter types some booleans as strings; Boolean("false") is true.
const truthy = (v) => {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  return ['true', '1', 'yes', 'y'].includes(String(v).trim().toLowerCase());
};

function flattenAddress(a) {
  if (!a) return '';
  return [
    [a.address_1, a.address_2].filter(Boolean).join(' '),
    [a.city, a.state].filter(Boolean).join(', '),
    [a.zipcode ?? a.zip, a.country].filter(Boolean).join(' ')
  ].map(s => str(s)).filter(Boolean).join('\n');
}

function tagList(tags) {
  if (!tags) return '';
  if (Array.isArray(tags)) {
    return tags.map(t => (typeof t === 'string' ? t : str(t?.name ?? t?.label))).filter(Boolean).join(', ');
  }
  return str(tags);
}

// ── run ────────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
const logId = await logTbl.createRecordAsync({ 'Script': { name: 'Contacts' }, 'Started At': startedAt });

// 1 ── Pull contacts
let params = 'per_page=100';
if (UPDATED_WITHIN_DAYS) {
  const since = new Date(Date.now() - UPDATED_WITHIN_DAYS * 86400000).toISOString();
  params += `&updatedAfter=${encodeURIComponent(since)}`;
}

let contacts = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const json = await gb(`/contacts?${params}&page=${page}`);
  contacts.push(...(json.data ?? []));
  const meta = json.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) break;
  if (page === MAX_PAGES) console.log('⚠ Hit MAX_PAGES — some contacts were not fetched.');
}
console.log(`Fetched ${contacts.length} contacts`);

// 2 ── Index what we already have
const memberQ = await membersTbl.selectRecordsAsync({ fields: ['Contact ID'] });
const byContact = new Map(
  memberQ.records
    .filter(r => r.getCellValueAsString('Contact ID'))
    .map(r => [r.getCellValueAsString('Contact ID'), r.id])
);

// 3 ── Build the writes
const toCreate = [], toUpdate = [];

for (const c of contacts) {
  const cid = str(c.id);
  if (!cid) continue;

  const fields = {
    'Contact ID': cid,
    'First Name': str(c.first_name ?? c.preferred_name),
    'Last Name': str(c.last_name),
    'Email': str(c.primary_email ?? (c.emails ?? [])[0]?.value).toLowerCase(),
    'Phone': str(c.primary_phone ?? (c.phones ?? [])[0]?.value),
    'Tags': tagList(c.tags),
    'Email Subscribed': truthy(c.is_email_subscribed ?? c.email_opt_in),
    'Phone Subscribed': truthy(c.is_phone_subscribed ?? c.sms_opt_in),
    'Contact Since': dateOnly(c.contact_since ?? c.created_at),
    'Givebutter Total Given': Number(c.stats?.total_contributions) || 0,
    'Address': flattenAddress(c.primary_address ?? (c.addresses ?? [])[0]),
    'Givebutter Note': str(c.note),
    'Archived in Givebutter': Boolean(c.archived_at),
    'Contact Synced At': startedAt
  };

  const existing = byContact.get(cid);
  if (existing) toUpdate.push({ id: existing, fields });
  else toCreate.push({ fields });
}

for (let i = 0; i < toCreate.length; i += 50) await membersTbl.createRecordsAsync(toCreate.slice(i, i + 50));
for (let i = 0; i < toUpdate.length; i += 50) await membersTbl.updateRecordsAsync(toUpdate.slice(i, i + 50));

console.log(`Contacts — created ${toCreate.length}, updated ${toUpdate.length}`);

await logTbl.updateRecordAsync(logId, {
  'Records Created': toCreate.length,
  'Records Updated': toUpdate.length
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
