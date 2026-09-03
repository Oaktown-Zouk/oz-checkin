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

const GIVEBUTTER_API_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY';   // ← Settings → Integrations → API Keys — fill in only inside Airtable's own script editor, never commit the real value here
const GIVEBUTTER_API_BASE = 'https://api.givebutter.com/v1';
const MAX_PAGES = 40;                          // Airtable caps a script at 50 fetch() calls

const membersTable        = base.getTable('Members');
const recurringPlansTable = base.getTable('Recurring Plans');
const syncLogTable        = base.getTable('Sync Log');

// ── helpers ────────────────────────────────────────────────────────────

// The Scripting extension runs inside your browser, so a plain fetch() to
// Givebutter is blocked by CORS. remoteFetchAsync makes the request from
// Airtable's servers instead — but it exists ONLY in the extension.
// Automation scripts have no browser, so fetch() works there and
// remoteFetchAsync is undefined. Pick whichever this context has.
const httpGet = (typeof remoteFetchAsync === 'function') ? remoteFetchAsync : fetch;

async function fetchFromGivebutter(path) {
  const response = await httpGet(`${GIVEBUTTER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GIVEBUTTER_API_KEY}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Givebutter ${response.status} on ${path}: ${await response.text()}`);
  return response.json();
}

// Normalize any value bound for a single select: trim it, and turn blanks into
// null. Trailing whitespace from an API is invisible in logs and will fail a
// select write even when the value looks identical to an existing choice.
const normalizeSelectText = (value) => (value == null ? null : (String(value).trim() || null));

// Single select WRITE format. The Scripting API wants {name: "..."} or
// {id: "..."} — a bare string is rejected with "cannot accept the provided
// value", even when the choice exists verbatim. (The REST API and the
// no-code "Update record" action both accept plain strings, which is what
// makes this so easy to get wrong.)
const toSelectField = (value) => { const text = normalizeSelectText(value); return text ? { name: text } : null; };

const toText = (value) => (value == null ? '' : String(value).trim());
const toDateOnly = (value) => (value ? String(value).slice(0, 10) : null);

// Single selects reject any value not already in their choice list, and they're
// case-sensitive. Rather than guess Givebutter's vocabulary, widen the field to
// fit the data. updateOptionsAsync REPLACES the list, so existing choices must
// be passed back WITH their ids or every record using them gets orphaned.
async function ensureSelectChoices(table, fieldName, values) {
  const field = table.getField(fieldName);
  if (!['singleSelect', 'multipleSelects'].includes(field.type)) return;
  const existingChoices = field.options.choices ?? [];
  const existingChoiceNames = new Set(existingChoices.map(c => c.name));
  const missingChoiceNames = [...new Set(values.map(normalizeSelectText).filter(v => v && !existingChoiceNames.has(v)))];
  if (!missingChoiceNames.length) return;
  // updateOptionsAsync is extension-only. In an automation this throws, so
  // fail with an instruction rather than a stack trace.
  try {
    await field.updateOptionsAsync({
      choices: [...existingChoices.map(c => ({ id: c.id, name: c.name })), ...missingChoiceNames.map(name => ({ name }))]
    });
    console.log(`⚠ ${fieldName}: added option(s) → ${missingChoiceNames.map(m => JSON.stringify(m)).join(', ')}`);
  } catch (e) {
    console.log(`⚠ Cannot add option(s) ${missingChoiceNames.map(m => JSON.stringify(m)).join(', ')} to "${field.name}" in "${table.name}"from an automation. Add this option in the field editor.`);
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
const syncLogRecordId = await syncLogTable.createRecordAsync({ 'Script': { name: 'Plans' }, 'Started At': startedAt });

// 1 ── Pull every recurring plan
let plans = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const responseBody = await fetchFromGivebutter(`/plans?page=${page}&per_page=100`);
  plans.push(...(responseBody.data ?? []));
  const meta = responseBody.meta ?? {};
  if (!meta.last_page || page >= meta.last_page) break;
  if (page === MAX_PAGES) console.log('⚠ Hit MAX_PAGES — some plans were not fetched.');
}
console.log(`Fetched ${plans.length} plans`);
// JSON.stringify so hidden whitespace and casing are actually visible
console.log('Statuses seen:', [...new Set(plans.map(p => p.status))].map(v => JSON.stringify(v)).join(', '));
console.log('Frequencies seen:', [...new Set(plans.map(p => p.frequency))].map(v => JSON.stringify(v)).join(', '));

// 2 ── Index what Airtable already has
const memberQuery = await membersTable.selectRecordsAsync({
  fields: ['Contact ID', 'First Name', 'Last Name', 'Email', 'Phone']
});
const memberIdByContactId = new Map();
const memberFieldsByContactId = new Map();   // contactId → current field values
for (const record of memberQuery.records) {
  const contactId = record.getCellValueAsString('Contact ID');
  if (!contactId) continue;
  memberIdByContactId.set(contactId, record.id);
  memberFieldsByContactId.set(contactId, {
    first: record.getCellValueAsString('First Name'),
    last:  record.getCellValueAsString('Last Name'),
    email: record.getCellValueAsString('Email'),
    phone: record.getCellValueAsString('Phone')
  });
}

// 'Covers Member' = who the membership is FOR (vs 'Member' = who pays).
// Gift memberships get reassigned by hand, so we only ever fill it when blank.
const hasCoversMemberField = recurringPlansTable.fields.some(f => f.name === 'Covers Member');
const recurringPlanQuery = await recurringPlansTable.selectRecordsAsync({
  fields: hasCoversMemberField ? ['Plan ID', 'Covers Member'] : ['Plan ID']
});
const recurringPlanIdByPlanId = new Map(recurringPlanQuery.records.map(r => [r.getCellValueAsString('Plan ID'), r.id]));
const planIdsWithCoversMemberAssigned = new Set(
  hasCoversMemberField
    ? recurringPlanQuery.records.filter(r => (r.getCellValue('Covers Member') ?? []).length)
                                 .map(r => r.getCellValueAsString('Plan ID'))
    : []
);

// 3 ── Create missing Members, refresh the ones that drifted
const membersToCreate = [], membersToUpdate = [];
const seenContactIds = new Set();

for (const plan of plans) {
  const contactId = plan.contact_id == null ? '' : String(plan.contact_id);
  if (!contactId || seenContactIds.has(contactId)) continue;
  seenContactIds.add(contactId);

  const incomingMemberFields = {
    first: toText(plan.first_name),
    last:  toText(plan.last_name),
    email: toText(plan.email),
    phone: toText(plan.phone)
  };

  if (!memberIdByContactId.has(contactId)) {
    memberIdByContactId.set(contactId, null);          // reserve so we don't queue a duplicate
    membersToCreate.push({ fields: {
      'Contact ID': contactId,
      'First Name': incomingMemberFields.first,
      'Last Name': incomingMemberFields.last,
      'Email': incomingMemberFields.email,
      'Phone': incomingMemberFields.phone
    }});
    continue;
  }

  // Existing member — only write the fields that actually changed, so we're not
  // churning every record (and every "last modified" timestamp) nightly.
  const currentMemberFields = memberFieldsByContactId.get(contactId) ?? {};
  const changedMemberFields = {};
  if (incomingMemberFields.first && incomingMemberFields.first !== currentMemberFields.first) changedMemberFields['First Name'] = incomingMemberFields.first;
  if (incomingMemberFields.last  && incomingMemberFields.last  !== currentMemberFields.last)  changedMemberFields['Last Name']  = incomingMemberFields.last;
  if (incomingMemberFields.email && incomingMemberFields.email !== currentMemberFields.email) changedMemberFields['Email']      = incomingMemberFields.email;
  if (incomingMemberFields.phone && incomingMemberFields.phone !== currentMemberFields.phone) changedMemberFields['Phone']      = incomingMemberFields.phone;
  if (Object.keys(changedMemberFields).length) membersToUpdate.push({ id: memberIdByContactId.get(contactId), fields: changedMemberFields });
}

for (let i = 0; i < membersToCreate.length; i += 50) {
  const newMemberBatch = membersToCreate.slice(i, i + 50);
  const createdMemberIds = await membersTable.createRecordsAsync(newMemberBatch);
  createdMemberIds.forEach((createdMemberId, index) => memberIdByContactId.set(newMemberBatch[index].fields['Contact ID'], createdMemberId));
}
for (let i = 0; i < membersToUpdate.length; i += 50) {
  await membersTable.updateRecordsAsync(membersToUpdate.slice(i, i + 50));
}
console.log(`Members created: ${membersToCreate.length}, refreshed: ${membersToUpdate.length}`);

// 4 ── Widen the select fields to whatever Givebutter actually sent
await ensureSelectChoices(recurringPlansTable, 'Status',    plans.map(p => p.status));
await ensureSelectChoices(recurringPlansTable, 'Frequency', plans.map(p => p.frequency));

// 5 ── Upsert the plans
const syncedAt = new Date().toISOString();
const recurringPlansToCreate = [], recurringPlansToUpdate = [];

for (const plan of plans) {
  const planFields = {
    'Plan ID': String(plan.id),
    'Status': toSelectField(plan.status),
    'Amount': Number(plan.amount) || 0,
    'Frequency': toSelectField(plan.frequency),
    'Method': toText(plan.method),
    'Fee Covered': Boolean(plan.fee_covered),
    'Start Date': toDateOnly(plan.start_at),
    'Next Bill Date': toDateOnly(plan.next_bill_date),
    'Canceled At': toDateOnly(plan.canceled_at),
    'Last Synced': syncedAt
  };

  const memberRecordId = memberIdByContactId.get(plan.contact_id == null ? '' : String(plan.contact_id));
  if (memberRecordId) {
    planFields['Member'] = [{ id: memberRecordId }];
    // Default the beneficiary to the payer, but NEVER overwrite a manual
    // assignment — that's how a gift membership stays pointed at the spouse.
    if (hasCoversMemberField && !planIdsWithCoversMemberAssigned.has(String(plan.id))) {
      planFields['Covers Member'] = [{ id: memberRecordId }];
    }
  }

  const existingRecurringPlanId = recurringPlanIdByPlanId.get(String(plan.id));
  if (existingRecurringPlanId) recurringPlansToUpdate.push({ id: existingRecurringPlanId, fields: planFields });
  else recurringPlansToCreate.push({ fields: planFields });
}

for (let i = 0; i < recurringPlansToCreate.length; i += 50) await recurringPlansTable.createRecordsAsync(recurringPlansToCreate.slice(i, i + 50));
for (let i = 0; i < recurringPlansToUpdate.length; i += 50) await recurringPlansTable.updateRecordsAsync(recurringPlansToUpdate.slice(i, i + 50));

console.log(`Plans — created ${recurringPlansToCreate.length}, updated ${recurringPlansToUpdate.length}`);

// 6 ── Keep each member's Tier Rule link pointing at the matching Tiers row.
//      This is what lets "Classes Allowed" be a rollup off the Tiers table
//      instead of a second copy of the allowance numbers.
//
//      Runs last, after plan amounts are written, so Tier has settled. A tier
//      that changed during THIS run may not be recalculated yet — it corrects
//      on the next nightly run, and the check-in automation repairs it on the
//      spot if someone shows up before then.
const tiersTable = base.tables.find(t => t.name === 'Tiers');
const membersTableHasTierRuleField = membersTable.fields.some(f => f.name === 'Tier Rule');

if (tiersTable && membersTableHasTierRuleField) {
  // Match on AMOUNT, not on tier name. Tier is now derived FROM this link,
  // so matching by name would be circular.
  const tierQuery = await tiersTable.selectRecordsAsync({ fields: ['Tier', 'Min Monthly Price'] });
  const tierRules = tierQuery.records
    .map(record => ({ id: record.id, name: record.getCellValueAsString('Tier'), min: record.getCellValue('Min Monthly Price') ?? 0 }))
    .sort((a, b) => b.min - a.min);            // richest first

  const tierRuleForAmount = (amount) => (!amount || amount <= 0) ? null : (tierRules.find(rule => amount >= rule.min) ?? null);

  const memberTierLinkQuery = await membersTable.selectRecordsAsync({ fields: ['Membership Amount', 'Tier Rule'] });
  const tierRuleLinkUpdates = [];

  for (const record of memberTierLinkQuery.records) {
    const desiredTierRule = tierRuleForAmount(record.getCellValue('Membership Amount') ?? 0);
    const currentTierRuleId = (record.getCellValue('Tier Rule') ?? [])[0]?.id ?? null;
    if ((desiredTierRule?.id ?? null) === currentTierRuleId) continue;
    tierRuleLinkUpdates.push({ id: record.id, fields: { 'Tier Rule': desiredTierRule ? [{ id: desiredTierRule.id }] : [] } });
  }

  for (let i = 0; i < tierRuleLinkUpdates.length; i += 50) {
    await membersTable.updateRecordsAsync(tierRuleLinkUpdates.slice(i, i + 50));
  }
  console.log(`Tier Rule links updated: ${tierRuleLinkUpdates.length}`);
} else {
  console.log('Skipping Tier Rule sync — Tiers table or Tier Rule field not found.');
}

// 7 ── Close out the log row (only reached if everything above succeeded)
await syncLogTable.updateRecordAsync(syncLogRecordId, {
  'Records Created': recurringPlansToCreate.length + membersToCreate.length,
  'Records Updated': recurringPlansToUpdate.length + membersToUpdate.length
});
