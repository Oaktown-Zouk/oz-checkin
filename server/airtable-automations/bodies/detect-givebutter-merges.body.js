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

// ═══ END CONFIG ═══

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
