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

const GB_KEY        = 'REPLACE_WITH_GIVEBUTTER_API_KEY';
const GB_BASE       = 'https://api.givebutter.com/v1';
const LOOKBACK_DAYS = 7;      // ← 3650 for the historical backfill
const MAX_PAGES     = 40;     // Airtable caps a script at 50 fetch() calls

const membersTbl = base.getTable('Members');
const txTbl      = base.getTable('Transactions');
const logTbl     = base.getTable('Sync Log');

// ── helpers ────────────────────────────────────────────────────────────

async function gb(path) {
  const res = await fetch(`${GB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GB_KEY}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Givebutter ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// Trim select values and turn blanks into null — invisible trailing whitespace
// from an API will fail a select write even when the value looks correct.
const sel = (v) => (v == null ? null : (String(v).trim() || null));

// Single select WRITE format: the Scripting API requires {name: "..."} —
// a bare string is rejected even when the choice exists verbatim.
const selVal = (v) => { const s = sel(v); return s ? { name: s } : null; };

const str = (v) => (v == null ? '' : String(v).trim());

// Prefer real first/last fields. Fall back to splitting a combined name on the
// LAST space — a heuristic that gets "Maria Delgado" right and "Ana van der
// Berg" wrong. The plans sync corrects any donor who later becomes a member,
// since /plans returns proper first_name / last_name.
function nameParts(t) {
  const first = str(t.first_name ?? t.contact?.first_name);
  const last  = str(t.last_name  ?? t.contact?.last_name);
  if (first || last) return { first, last };

  const full = str(t.contact?.name ?? t.name);
  if (!full) return { first: '', last: '' };
  const parts = full.split(/\s+/);
  return parts.length === 1
    ? { first: full, last: '' }
    : { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// See sync-plans.js for why this exists. Existing choices must be passed back
// WITH their ids — updateOptionsAsync replaces the whole list.
async function ensureChoices(tbl, fieldName, values) {
  const field = tbl.getField(fieldName);
  if (!['singleSelect', 'multipleSelects'].includes(field.type)) return;
  const existing = field.options.choices ?? [];
  const have = new Set(existing.map(c => c.name));
  const missing = [...new Set(values.map(sel).filter(v => v && !have.has(v)))];
  if (!missing.length) return;
  await field.updateOptionsAsync({
    choices: [...existing.map(c => ({ id: c.id, name: c.name })), ...missing.map(name => ({ name }))]
  });
  console.log(`⚠ ${fieldName}: added option(s) → ${missing.map(m => JSON.stringify(m)).join(', ')}`);
}

// ── run ────────────────────────────────────────────────────────────────
//
// IMPORTANT: Airtable disables ALL further writes in a script run once any
// single write fails. So the Sync Log row is created UP FRONT and filled in at
// the end. A log row left with blank counts means that run died partway.

const startedAt = new Date().toISOString();
const logId = await logTbl.createRecordAsync({ 'Script': { name: 'Transactions' }, 'Started At': startedAt });

// 1 ── Pull transactions inside the window
const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
let txns = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const json = await gb(
    `/transactions?scope=all&transactedAfter=${encodeURIComponent(since)}&page=${page}&per_page=100`
  );
  txns.push(...(json.data ?? []));
  const meta = json.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) break;
  if (page === MAX_PAGES) console.log('⚠ Hit MAX_PAGES — narrow LOOKBACK_DAYS and re-run.');
}
console.log(`Fetched ${txns.length} transactions since ${since.slice(0, 10)}`);
console.log('Statuses seen:', [...new Set(txns.map(t => t.status))].map(v => JSON.stringify(v)).join(', '));

// 2 ── Index what Airtable already has
const memberQ = await membersTbl.selectRecordsAsync({
  fields: ['Contact ID', 'First Name', 'Last Name', 'Email']
});
const memberByContact = new Map();
const memberSnapshot  = new Map();
for (const r of memberQ.records) {
  const cid = r.getCellValueAsString('Contact ID');
  if (!cid) continue;
  memberByContact.set(cid, r.id);
  memberSnapshot.set(cid, {
    first: r.getCellValueAsString('First Name'),
    last:  r.getCellValueAsString('Last Name'),
    email: r.getCellValueAsString('Email')
  });
}

const txQ = await txTbl.selectRecordsAsync({ fields: ['Transaction ID'] });
const txById = new Map(txQ.records.map(r => [r.getCellValueAsString('Transaction ID'), r.id]));

// 3 ── One-time donors get a Member row too.
//      Membership Status will read "Lapsed / Donor" — they only become a
//      member when an active recurring plan shows up in the plans sync.
const newMembers = [], memberFills = [];
const seen = new Set();

for (const t of txns) {
  const cid = t.contact_id == null ? '' : String(t.contact_id);
  if (!cid || seen.has(cid)) continue;
  seen.add(cid);

  const { first, last } = nameParts(t);
  const email = str(t.email ?? t.contact?.email);
  const phone = str(t.phone ?? t.contact?.phone);

  if (!memberByContact.has(cid)) {
    memberByContact.set(cid, null);
    newMembers.push({ fields: {
      'Contact ID': cid, 'First Name': first, 'Last Name': last,
      'Email': email, 'Phone': phone
    }});
    continue;
  }

  // Fill blanks only — never overwrite what the plans sync established.
  const current = memberSnapshot.get(cid) ?? {};
  const changed = {};
  if (first && !current.first) changed['First Name'] = first;
  if (last  && !current.last)  changed['Last Name']  = last;
  if (email && !current.email) changed['Email']      = email;
  if (Object.keys(changed).length) memberFills.push({ id: memberByContact.get(cid), fields: changed });
}

for (let i = 0; i < newMembers.length; i += 50) {
  const batch = newMembers.slice(i, i + 50);
  const ids = await membersTbl.createRecordsAsync(batch);
  ids.forEach((rid, j) => memberByContact.set(batch[j].fields['Contact ID'], rid));
}
for (let i = 0; i < memberFills.length; i += 50) {
  await membersTbl.updateRecordsAsync(memberFills.slice(i, i + 50));
}
console.log(`Members created: ${newMembers.length}, gaps filled: ${memberFills.length}`);

// 4 ── Widen the Status select to whatever Givebutter actually sent
await ensureChoices(txTbl, 'Status', txns.map(t => t.status));

// 5 ── Upsert the transactions
const now = new Date().toISOString();
const toCreate = [], toUpdate = [];

for (const t of txns) {
  const fields = {
    'Transaction ID': String(t.id),
    'Amount': Number(t.amount) || 0,
    'Fee': Number(t.fee) || 0,
    'Donated': Number(t.donated) || 0,
    'Status': selVal(t.status),
    'Payment Method': str(t.payment_method ?? t.method),
    'Campaign': str(t.campaign?.title ?? t.campaign_code),
    'Transacted At': t.transacted_at ?? t.created_at ?? null,
    'Last Synced': now
  };

  const memberRecId = memberByContact.get(t.contact_id == null ? '' : String(t.contact_id));
  if (memberRecId) fields['Member'] = [{ id: memberRecId }];

  const existing = txById.get(String(t.id));
  if (existing) toUpdate.push({ id: existing, fields });
  else toCreate.push({ fields });
}

for (let i = 0; i < toCreate.length; i += 50) await txTbl.createRecordsAsync(toCreate.slice(i, i + 50));
for (let i = 0; i < toUpdate.length; i += 50) await txTbl.updateRecordsAsync(toUpdate.slice(i, i + 50));

console.log(`Transactions — created ${toCreate.length}, updated ${toUpdate.length}`);

// 6 ── Close out the log row (only reached if everything above succeeded)
await logTbl.updateRecordAsync(logId, {
  'Records Created': toCreate.length + newMembers.length,
  'Records Updated': toUpdate.length + memberFills.length
});
