// ═══════════════════════════════════════════════════════════════════════
// Givebutter → Airtable :: RECURRING PLANS  (membership source of truth)
//
// Airtable → Automations → Trigger "At scheduled time" (daily, 3:00 AM PT)
//          → Action "Run a script"  ·  no input variables needed
//
// Safe to re-run: every write is keyed on Plan ID / Contact ID.
//
// NAMES: writes First Name and Last Name. It does NOT write Full Name —
// that's a formula field (see the builder doc's manual pass). Givebutter is
// authoritative here, so a name changed there overwrites Airtable on the
// next run.
// ═══════════════════════════════════════════════════════════════════════

const GB_KEY    = 'REPLACE_WITH_GIVEBUTTER_API_KEY';   // ← Settings → Integrations → API Keys
const GB_BASE   = 'https://api.givebutter.com/v1';
const MAX_PAGES = 40;                          // Airtable caps a script at 50 fetch() calls

const membersTbl = base.getTable('Members');
const plansTbl   = base.getTable('Recurring Plans');
const logTbl     = base.getTable('Sync Log');

// ── helpers ────────────────────────────────────────────────────────────

// The Scripting extension runs inside your browser, so a plain fetch() to
// Givebutter is blocked by CORS. remoteFetchAsync makes the request from
// Airtable's servers instead — but it exists ONLY in the extension.
// Automation scripts have no browser, so fetch() works there and
// remoteFetchAsync is undefined. Pick whichever this context has.
const httpGet = (typeof remoteFetchAsync === 'function') ? remoteFetchAsync : fetch;

async function gb(path) {
  const res = await httpGet(`${GB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GB_KEY}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Givebutter ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// Normalize any value bound for a single select: trim it, and turn blanks into
// null. Trailing whitespace from an API is invisible in logs and will fail a
// select write even when the value looks identical to an existing choice.
const sel = (v) => (v == null ? null : (String(v).trim() || null));

// Single select WRITE format. The Scripting API wants {name: "..."} or
// {id: "..."} — a bare string is rejected with "cannot accept the provided
// value", even when the choice exists verbatim. (The REST API and the
// no-code "Update record" action both accept plain strings, which is what
// makes this so easy to get wrong.)
const selVal = (v) => { const s = sel(v); return s ? { name: s } : null; };

const str = (v) => (v == null ? '' : String(v).trim());
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

// Single selects reject any value not already in their choice list, and they're
// case-sensitive. Rather than guess Givebutter's vocabulary, widen the field to
// fit the data. updateOptionsAsync REPLACES the list, so existing choices must
// be passed back WITH their ids or every record using them gets orphaned.
async function ensureChoices(tbl, fieldName, values) {
  const field = tbl.getField(fieldName);
  if (!['singleSelect', 'multipleSelects'].includes(field.type)) return;
  const existing = field.options.choices ?? [];
  const have = new Set(existing.map(c => c.name));
  const missing = [...new Set(values.map(sel).filter(v => v && !have.has(v)))];
  if (!missing.length) return;
  // updateOptionsAsync is extension-only. In an automation this throws, so
  // fail with an instruction rather than a stack trace.
  try {
    await field.updateOptionsAsync({
      choices: [...existing.map(c => ({ id: c.id, name: c.name })), ...missing.map(name => ({ name }))]
    });
    console.log(`⚠ ${fieldName}: added option(s) → ${missing.map(m => JSON.stringify(m)).join(', ')}`);
  } catch (e) {
    console.log(`⚠ Cannot add option(s) ${missing.map(m => JSON.stringify(m)).join(', ')} to "${field.name}" in "${tbl.name}"from an automation. Add this option in the field editor.`);
  }
}

// ── run ────────────────────────────────────────────────────────────────
//
// IMPORTANT: Airtable disables ALL further writes in a script run once any
// single write fails ("Request processing is disabled due to earlier failed
// request"). So the Sync Log row is created UP FRONT and filled in at the end.
// A log row left with blank counts means that run died partway — check the
// automation's run history for the actual error.

const startedAt = new Date().toISOString();
const logId = await logTbl.createRecordAsync({ 'Script': { name: 'Plans' }, 'Started At': startedAt });

// 1 ── Pull every recurring plan
let plans = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const json = await gb(`/plans?page=${page}&per_page=100`);
  plans.push(...(json.data ?? []));
  const meta = json.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) break;
  if (page === MAX_PAGES) console.log('⚠ Hit MAX_PAGES — some plans were not fetched.');
}
console.log(`Fetched ${plans.length} plans`);
// JSON.stringify so hidden whitespace and casing are actually visible
console.log('Statuses seen:', [...new Set(plans.map(p => p.status))].map(v => JSON.stringify(v)).join(', '));
console.log('Frequencies seen:', [...new Set(plans.map(p => p.frequency))].map(v => JSON.stringify(v)).join(', '));

// 2 ── Index what Airtable already has
const memberQ = await membersTbl.selectRecordsAsync({
  fields: ['Contact ID', 'First Name', 'Last Name', 'Email', 'Phone']
});
const memberByContact = new Map();
const memberSnapshot  = new Map();   // contactId → current field values
for (const r of memberQ.records) {
  const cid = r.getCellValueAsString('Contact ID');
  if (!cid) continue;
  memberByContact.set(cid, r.id);
  memberSnapshot.set(cid, {
    first: r.getCellValueAsString('First Name'),
    last:  r.getCellValueAsString('Last Name'),
    email: r.getCellValueAsString('Email'),
    phone: r.getCellValueAsString('Phone')
  });
}

// 'Covers Member' = who the membership is FOR (vs 'Member' = who pays).
// Gift memberships get reassigned by hand, so we only ever fill it when blank.
const hasCovers = plansTbl.fields.some(f => f.name === 'Covers Member');
const planQ = await plansTbl.selectRecordsAsync({
  fields: hasCovers ? ['Plan ID', 'Covers Member'] : ['Plan ID']
});
const planById = new Map(planQ.records.map(r => [r.getCellValueAsString('Plan ID'), r.id]));
const coversSet = new Set(
  hasCovers
    ? planQ.records.filter(r => (r.getCellValue('Covers Member') ?? []).length)
                   .map(r => r.getCellValueAsString('Plan ID'))
    : []
);

// 3 ── Create missing Members, refresh the ones that drifted
const newMembers = [], memberUpdates = [];
const seen = new Set();

for (const p of plans) {
  const cid = p.contact_id == null ? '' : String(p.contact_id);
  if (!cid || seen.has(cid)) continue;
  seen.add(cid);

  const incoming = {
    first: str(p.first_name),
    last:  str(p.last_name),
    email: str(p.email),
    phone: str(p.phone)
  };

  if (!memberByContact.has(cid)) {
    memberByContact.set(cid, null);          // reserve so we don't queue a duplicate
    newMembers.push({ fields: {
      'Contact ID': cid,
      'First Name': incoming.first,
      'Last Name': incoming.last,
      'Email': incoming.email,
      'Phone': incoming.phone
    }});
    continue;
  }

  // Existing member — only write the fields that actually changed, so we're not
  // churning every record (and every "last modified" timestamp) nightly.
  const current = memberSnapshot.get(cid) ?? {};
  const changed = {};
  if (incoming.first && incoming.first !== current.first) changed['First Name'] = incoming.first;
  if (incoming.last  && incoming.last  !== current.last)  changed['Last Name']  = incoming.last;
  if (incoming.email && incoming.email !== current.email) changed['Email']      = incoming.email;
  if (incoming.phone && incoming.phone !== current.phone) changed['Phone']      = incoming.phone;
  if (Object.keys(changed).length) memberUpdates.push({ id: memberByContact.get(cid), fields: changed });
}

for (let i = 0; i < newMembers.length; i += 50) {
  const batch = newMembers.slice(i, i + 50);
  const ids = await membersTbl.createRecordsAsync(batch);
  ids.forEach((rid, j) => memberByContact.set(batch[j].fields['Contact ID'], rid));
}
for (let i = 0; i < memberUpdates.length; i += 50) {
  await membersTbl.updateRecordsAsync(memberUpdates.slice(i, i + 50));
}
console.log(`Members created: ${newMembers.length}, refreshed: ${memberUpdates.length}`);

// 4 ── Widen the select fields to whatever Givebutter actually sent
await ensureChoices(plansTbl, 'Status',    plans.map(p => p.status));
await ensureChoices(plansTbl, 'Frequency', plans.map(p => p.frequency));

// 5 ── Upsert the plans
const now = new Date().toISOString();
const toCreate = [], toUpdate = [];

for (const p of plans) {
  const fields = {
    'Plan ID': String(p.id),
    'Status': selVal(p.status),
    'Amount': Number(p.amount) || 0,
    'Frequency': selVal(p.frequency),
    'Method': str(p.method),
    'Fee Covered': Boolean(p.fee_covered),
    'Start Date': dateOnly(p.start_at),
    'Next Bill Date': dateOnly(p.next_bill_date),
    'Canceled At': dateOnly(p.canceled_at),
    'Last Synced': now
  };

  const memberRecId = memberByContact.get(p.contact_id == null ? '' : String(p.contact_id));
  if (memberRecId) {
    fields['Member'] = [{ id: memberRecId }];
    // Default the beneficiary to the payer, but NEVER overwrite a manual
    // assignment — that's how a gift membership stays pointed at the spouse.
    if (hasCovers && !coversSet.has(String(p.id))) {
      fields['Covers Member'] = [{ id: memberRecId }];
    }
  }

  const existing = planById.get(String(p.id));
  if (existing) toUpdate.push({ id: existing, fields });
  else toCreate.push({ fields });
}

for (let i = 0; i < toCreate.length; i += 50) await plansTbl.createRecordsAsync(toCreate.slice(i, i + 50));
for (let i = 0; i < toUpdate.length; i += 50) await plansTbl.updateRecordsAsync(toUpdate.slice(i, i + 50));

console.log(`Plans — created ${toCreate.length}, updated ${toUpdate.length}`);

// 6 ── Keep each member's Tier Rule link pointing at the matching Tiers row.
//      This is what lets "Classes Allowed" be a rollup off the Tiers table
//      instead of a second copy of the allowance numbers.
//
//      Runs last, after plan amounts are written, so Tier has settled. A tier
//      that changed during THIS run may not be recalculated yet — it corrects
//      on the next nightly run, and the check-in automation repairs it on the
//      spot if someone shows up before then.
const tiersTbl = base.tables.find(t => t.name === 'Tiers');
const hasTierRule = membersTbl.fields.some(f => f.name === 'Tier Rule');

if (tiersTbl && hasTierRule) {
  // Match on AMOUNT, not on tier name. Tier is now derived FROM this link,
  // so matching by name would be circular.
  const tierQ = await tiersTbl.selectRecordsAsync({ fields: ['Tier', 'Min Monthly Price'] });
  const rules = tierQ.records
    .map(r => ({ id: r.id, name: r.getCellValueAsString('Tier'), min: r.getCellValue('Min Monthly Price') ?? 0 }))
    .sort((a, b) => b.min - a.min);            // richest first

  const ruleFor = (amt) => (!amt || amt <= 0) ? null : (rules.find(r => amt >= r.min) ?? null);

  const linkQ = await membersTbl.selectRecordsAsync({ fields: ['Membership Amount', 'Tier Rule'] });
  const linkUpdates = [];

  for (const r of linkQ.records) {
    const want = ruleFor(r.getCellValue('Membership Amount') ?? 0);
    const have = (r.getCellValue('Tier Rule') ?? [])[0]?.id ?? null;
    if ((want?.id ?? null) === have) continue;
    linkUpdates.push({ id: r.id, fields: { 'Tier Rule': want ? [{ id: want.id }] : [] } });
  }

  for (let i = 0; i < linkUpdates.length; i += 50) {
    await membersTbl.updateRecordsAsync(linkUpdates.slice(i, i + 50));
  }
  console.log(`Tier Rule links updated: ${linkUpdates.length}`);
} else {
  console.log('Skipping Tier Rule sync — Tiers table or Tier Rule field not found.');
}

// 7 ── Close out the log row (only reached if everything above succeeded)
await logTbl.updateRecordAsync(logId, {
  'Records Created': toCreate.length + newMembers.length,
  'Records Updated': toUpdate.length + memberUpdates.length
});
