// ═══════════════════════════════════════════════════════════════════════
// Assign a member's tier from the Tiers table
//
// Picks the highest-priced Tiers row whose "Min Monthly Price" is <= the
// member's Membership Amount, and links it via Tier Rule. Everything else
// follows from that link:
//
//   Tier Rule  →  Tier Name (rollup)  →  Tier (formula)
//              →  Classes Allowed (rollup)  →  Remaining Today
//
// So pricing, tier names, and allowances all live in ONE table. Nothing is
// hardcoded here — add a "3 classes" row at $220 and it starts being assigned
// with no script change.
//
// ── Wire it up two ways (both, ideally) ──────────────────────────────────
//
// A. IMMEDIATE — Airtable automation:
//      Trigger: "When record updated"  ·  table Members
//               watch field: Current Membership Payment
//      Action:  "Run a script"
//      Input variable:  recordId  =  the trigger record's Airtable record ID
//    Set RUN_MODE = 'single' below.
//
// B. BACKSTOP — Scripting extension, run any time to re-link everyone.
//    Set RUN_MODE = 'all'. Also what to run right after editing Tiers.
//
// The nightly plans sync does the same job, so this is belt-and-braces.
// ═══════════════════════════════════════════════════════════════════════

const RUN_MODE = 'single';        // 'single' for the automation, 'all' for a sweep

const membersTbl = base.getTable('Members');
const tiersTbl   = base.getTable('Tiers');

// ── Load the rules, richest first ──────────────────────────────────────
const tierQ = await tiersTbl.selectRecordsAsync({ fields: ['Tier', 'Min Monthly Price'] });
const rules = tierQ.records
  .filter(r => !!r.getCellValue('Min Monthly Price'))
  .map(r => ({ id: r.id, name: r.getCellValueAsString('Tier'), min: r.getCellValue('Min Monthly Price') ?? 0 }))
  .sort((a, b) => b.min - a.min);

const staffTier = tierQ.records.find(r => r.getCellValue('Tier') == "Staff");

if (!rules.length) throw new Error('Tiers table is empty — nothing to assign.');

function ruleForMember(member) {
  if (!!member.getCellValue('isNotaflof')) {
    return rules[0];
  }
  if (member.getCellValue('isStaff')) {
    return staffTier;
  }
  const amount = member.getCellValue('Current Membership Payment') ?? 0;
  return ruleForAmount(amount);
}

// Highest rule the amount clears. Returns null below the cheapest tier,
// which correctly leaves a $0 member with no tier at all.
function ruleForAmount(amount) {
  if (!amount || amount <= 0) return null;
  return rules.find(r => amount >= r.min) ?? null;
}

// ── Work out which records to touch ────────────────────────────────────
const fields = ['Current Membership Payment', 'Tier Rule', 'Full Name', 'isNotaflof', 'isStaff'];
let records;

if (RUN_MODE === 'single') {
  const { recordId } = input.config();
  const rec = await membersTbl.selectRecordAsync(recordId, { fields });
  if (!rec) throw new Error(`Member ${recordId} not found`);
  records = [rec];
} else {
  const q = await membersTbl.selectRecordsAsync({ fields });
  records = q.records;
}

// ── Re-link where it differs ───────────────────────────────────────────
const updates = [];
const changes = [];

for (const rec of records) {
  const amount = rec.getCellValue('Current Membership Payment') ?? 0;
  const want = ruleForMember(rec);
  const have = (rec.getCellValue('Tier Rule') ?? [])[0]?.id ?? null;

  if ((want?.id ?? null) === have) continue;

  updates.push({ id: rec.id, fields: { 'Tier Rule': want ? [{ id: want.id }] : [] } });
  changes.push(`${rec.getCellValueAsString('Full Name') || rec.name}: $${amount}/mo → ${want ? want.name : 'no tier'}`);
}

for (let i = 0; i < updates.length; i += 50) {
  await membersTbl.updateRecordsAsync(updates.slice(i, i + 50));
}

const summary = updates.length
  ? `Re-linked ${updates.length} member(s):\n` + changes.map(c => `  ${c}`).join('\n')
  : 'No changes — every member already points at the right tier.';

console.log(summary);

// output.markdown only exists in the Scripting extension, not in automations
if (RUN_MODE === 'all' && typeof output !== 'undefined' && output.markdown) {
  output.markdown(`### ${updates.length} member(s) re-linked`);
  if (changes.length) output.table(changes.map(c => ({ Change: c })));
  output.markdown('#### Rules in effect (richest first)');
  output.table(rules.map(r => ({ Tier: r.name, 'Min monthly': `$${r.min}` })));
}
