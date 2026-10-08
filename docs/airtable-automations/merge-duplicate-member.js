// ═══════════════════════════════════════════════════════════════════════
// Merge a duplicate Member into the one it's a Duplicate Of
//
// Triggered by Members."Duplicate Of" being filled, however that happens:
// detect-givebutter-merges.js matching an email, the webapp's "Mark as
// duplicate…", or a person editing the cell.
//
//   1. Moves every link on the duplicate onto the survivor: Check-ins,
//      Transactions, Recurring Plans, Covered Plans, Comp Credits, Levelups,
//      Teacher Notes, Refund Requests, User Roles, and any link field added
//      to Members later. Rollups/formulas (credits, Access Status, ...)
//      recompute from the moved links on their own.
//   2. Copies Phone, Lead Level, Follow Level and New Member Credit onto the
//      survivor where the survivor's is blank — the survivor's own values
//      always win, and New Member Credit is never summed.
//   3. Ticks Duplicate last, so a run that fails partway leaves the
//      duplicate visible on the roster; re-running is safe (every step is a
//      no-op once done).
//
// Duplicate Of chains (A → B, B → C) resolve to the end of the chain.
//
// ── Wire it up ───────────────────────────────────────────────────────────
//   Trigger: "When record matches conditions" · table Members
//            condition: Duplicate Of is not empty
//   Action:  "Run a script"
//   Input variable:  recordId  =  the trigger record's Airtable record ID
//
// The trigger fires when a record starts matching, so re-pointing an
// already-filled Duplicate Of at a different Member needs the cell cleared
// first (or this script run by hand on that record).
// ═══════════════════════════════════════════════════════════════════════

const membersTbl = base.getTable('Members');

// Link fields that stay put: Tier Rule is assign-member-tier.js's job, and
// the Duplicate Of pair is how this merge is expressed in the first place.
const LINKS_NOT_MOVED = ['Tier Rule', 'Duplicate Of', 'Duplicates'];
const GAP_FILLED = ['Phone', 'Lead Level', 'Follow Level', 'New Member Credit'];

const linkFields = membersTbl.fields
  .filter(f => f.type === 'multipleRecordLinks' && !LINKS_NOT_MOVED.includes(f.name))
  .map(f => f.name);

// The primary field is what fills record.name for the log lines below.
const fields = ['Member', 'Duplicate Of', 'Duplicate', ...linkFields, ...GAP_FILLED];
const { recordId } = input.config();

const duplicate = await membersTbl.selectRecordAsync(recordId, { fields });
if (!duplicate) throw new Error(`Member ${recordId} not found`);

// ── Resolve the survivor, following any Duplicate Of chain ─────────────
let survivor = duplicate;
const seen = new Set([duplicate.id]);
for (;;) {
  const next = (survivor.getCellValue('Duplicate Of') ?? [])[0];
  if (!next) break;
  if (seen.has(next.id)) throw new Error(`Duplicate Of loops back on itself at ${next.name} — fix it by hand`);
  seen.add(next.id);
  survivor = await membersTbl.selectRecordAsync(next.id, { fields });
  if (!survivor) throw new Error(`Duplicate Of points at a missing Member (${next.id})`);
}
if (survivor.id === duplicate.id) {
  console.log(`${duplicate.name}: Duplicate Of is empty; nothing to merge`);
} else {
  console.log(`Merging ${duplicate.name} → ${survivor.name}`);

  // ── 1. Links: add to survivor first, then clear on the duplicate ──────
  const survivorUpdates = {}, duplicateUpdates = {};
  for (const name of linkFields) {
    const moving = duplicate.getCellValue(name) ?? [];
    if (!moving.length) continue;
    const kept = survivor.getCellValue(name) ?? [];
    const ids = new Set(kept.map(r => r.id));
    survivorUpdates[name] = [...kept, ...moving.filter(r => !ids.has(r.id))].map(r => ({ id: r.id }));
    duplicateUpdates[name] = [];
    console.log(`  ${name}: moving ${moving.length}`);
  }

  // ── 2. Gap-fill ───────────────────────────────────────────────────────
  for (const name of GAP_FILLED) {
    const mine = survivor.getCellValue(name), theirs = duplicate.getCellValue(name);
    if ((mine == null || mine === '') && theirs != null && theirs !== '') {
      survivorUpdates[name] = theirs;
      console.log(`  ${name}: filled from duplicate`);
    }
  }

  if (Object.keys(survivorUpdates).length) await membersTbl.updateRecordAsync(survivor.id, survivorUpdates);
  if (Object.keys(duplicateUpdates).length) await membersTbl.updateRecordAsync(duplicate.id, duplicateUpdates);

  // ── 3. Flag last ──────────────────────────────────────────────────────
  await membersTbl.updateRecordAsync(duplicate.id, { 'Duplicate': true });
  console.log(`Done: ${duplicate.name} is now a Duplicate of ${survivor.name}`);
}
