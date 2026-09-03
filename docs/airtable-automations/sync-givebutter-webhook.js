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
// ═══════════════════════════════════════════════════════════════════════

const GB_KEY  = 'REPLACE_WITH_GIVEBUTTER_API_KEY';
const GB_BASE = 'https://api.givebutter.com/v1';

const { eventName, resourceId } = input.config();

const membersTbl = base.getTable('Members');
const plansTbl   = base.getTable('Recurring Plans');
const txTbl      = base.getTable('Transactions');

// ── helpers ────────────────────────────────────────────────────────────
async function gb(path) {
  const res = await fetch(`${GB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${GB_KEY}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Givebutter ${res.status} on ${path}: ${await res.text()}`);
  const json = await res.json();
  return json.data ?? json;
}

const str = (v) => (v == null ? '' : String(v).trim());
const sel = (v) => { const s = str(v); return s ? { name: s } : null; };
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);
const truthy = (v) => {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  return ['true', '1', 'yes', 'y'].includes(String(v).trim().toLowerCase());
};

// Find-or-create by a text key, returning the record id
async function upsert(tbl, keyField, keyValue, fields) {
  const q = await tbl.selectRecordsAsync({ fields: [keyField] });
  const hit = q.records.find(r => r.getCellValueAsString(keyField) === String(keyValue));
  if (hit) { await tbl.updateRecordAsync(hit.id, fields); return hit.id; }
  return tbl.createRecordAsync(fields);
}

async function memberFor(contactId, first, last, email, phone) {
  const cid = str(contactId);
  if (!cid) return null;
  const q = await membersTbl.selectRecordsAsync({ fields: ['Contact ID', 'First Name', 'Last Name'] });
  const hit = q.records.find(r => r.getCellValueAsString('Contact ID') === cid);
  if (hit) {
    // Fill gaps only — never clobber a hand-corrected name
    const patch = {};
    if (str(first) && !hit.getCellValueAsString('First Name')) patch['First Name'] = str(first);
    if (str(last) && !hit.getCellValueAsString('Last Name'))  patch['Last Name']  = str(last);
    if (Object.keys(patch).length) await membersTbl.updateRecordAsync(hit.id, patch);
    return hit.id;
  }
  return membersTbl.createRecordAsync({
    'Contact ID': cid,
    'First Name': str(first),
    'Last Name': str(last),
    'Email': str(email).toLowerCase(),
    'Phone': str(phone)
  });
}

// ── route ──────────────────────────────────────────────────────────────
const evt = str(eventName);
const now = new Date().toISOString();

console.log(`Webook received for ${evt}`);

if (!resourceId) {
  throw new Error(`No resourceId in payload for event "${evt}" — re-check the input variable mapping.`);
}

if (evt.startsWith('plan.')) {
  const p = await gb(`/plans/${resourceId}`);
  const memberId = await memberFor(p.contact_id, p.first_name, p.last_name, p.email, p.phone);

  const fields = {
    'Plan ID': String(p.id),
    'Status': sel(p.status),
    'Amount': Number(p.amount) || 0,
    'Frequency': sel(p.frequency),
    'Method': str(p.method),
    'Fee Covered': Boolean(p.fee_covered),
    'Start Date': dateOnly(p.start_at),
    'Next Bill Date': dateOnly(p.next_bill_date),
    'Canceled At': dateOnly(p.canceled_at),
    'Last Synced': now
  };
  if (memberId) fields['Member'] = [{ id: memberId }];

  // Default the beneficiary to the payer, but never overwrite a gift
  // assignment someone made by hand.
  const existing = await plansTbl.selectRecordsAsync({ fields: ['Plan ID', 'Covers Member'] });
  const hit = existing.records.find(r => r.getCellValueAsString('Plan ID') === String(p.id));
  const alreadyAssigned = hit && (hit.getCellValue('Covers Member') ?? []).length > 0;
  if (memberId && !alreadyAssigned) fields['Covers Member'] = [{ id: memberId }];

  try {
    await upsert(plansTbl, 'Plan ID', p.id, fields);
  } catch (e) {
    console.log(`Failed to upsert ${plansTbl.name} with ${fields}`);
    throw e;
  }
  console.log(`${evt} → plan ${p.id} (${p.status}) synced`);

} else if (evt.startsWith('transaction.') || evt.startsWith('refund.')) {
  const t = await gb(`/transactions/${resourceId}`);
  const memberId = await memberFor(
    t.contact_id, t.first_name, t.last_name,
    t.email ?? t.contact?.email, t.phone ?? t.contact?.phone
  );

  const fields = {
    'Transaction ID': String(t.id),
    'Amount': Number(t.amount) || 0,
    'Fee': Number(t.fee) || 0,
    'Donated': Number(t.donated) || 0,
    'Status': sel(t.status),
    'Payment Method': str(t.payment_method ?? t.method),
    'Campaign': str(t.campaign?.title ?? t.campaign_code),
    'Transacted At': t.transacted_at ?? t.created_at ?? null,
    'Plan ID': str(t.plan_id),
    'Is Recurring': Boolean(t.plan_id) || truthy(t.is_recurring),
    'Refunded': truthy(t.refunded) || Boolean(t.refunded_at),
    'Refunded At': dateOnly(t.refunded_at),
    'Refunded Amount': Number(t.refunded_amount ?? 0) || 0,
    'Last Synced': now
  };
  if (memberId) fields['Member'] = [{ id: memberId }];

  await upsert(txTbl, 'Transaction ID', t.id, fields);
  console.log(`${evt} → transaction ${t.id} ($${t.amount}, ${t.plan_id ? 'membership' : 'drop-in'}) synced`);

} else if (evt === 'contact.created') {
  const c = await gb(`/contacts/${resourceId}`);
  await memberFor(c.id, c.first_name, c.last_name, c.primary_email ?? c.email, c.primary_phone ?? c.phone);
  console.log(`contact ${c.id} synced`);

} else {
  console.log(`Ignoring event: ${evt}`);
}

// ═══════════════════════════════════════════════════════════════════════
// SETUP
//
// 1. Automations → new automation → trigger "When webhook received".
//    Copy the generated URL. Leave the automation OFF for now.
//
// 2. Register it with Givebutter (webhooks are API-only there). From a
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
// 3. Back in the trigger config, click Test and make a real $1 transaction
//    (or resume/pause a plan). Airtable captures the live payload and shows
//    you its field paths.
//
// 4. Add the two input variables to the script action, mapping them to
//    whatever the captured payload actually calls them — most likely
//    `event` and `data.id`.
//
// 5. Turn the automation ON.
//
// KEEP THE NIGHTLY SYNCS. Webhooks get missed — a deploy, an outage, a
// dropped delivery. The 3am runs are the reconciliation pass that makes
// missed events self-healing. This just means you don't wait until 3am.
// ═══════════════════════════════════════════════════════════════════════
