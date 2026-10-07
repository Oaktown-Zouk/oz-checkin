// ═══════════════════════════════════════════════════════════════════════
// Link a Class Feedback record to the Session it's about
//
// Class ("Level 2") picks the Program ("Zouk L2"); then, within that
// Program's Sessions:
//   Date filled in   →  the Session on that Day
//   Date blank       →  the latest Session starting at or before submission
//                       (Original Submission Date, else Created)
//
// Comparing real timestamps means skipped weeks, schedule changes, and
// timezones all take care of themselves — no weekday math.
//
// Once linked, Class Feedback's Instructors lookup follows the link, so
// feedback shows who taught that night (subs included).
//
// Classes with no matching Program ("Class before Social …", "Other") and
// Dates with no scheduled Session stay unlinked; the script logs them.
//
// ── Wire it up two ways ──────────────────────────────────────────────────
//
// A. IMMEDIATE — Airtable automation:
//      Trigger: "When record created"  ·  table Class Feedback
//               (optionally a second automation on "When record updated",
//                watching Class and Date, to re-link after edits)
//      Action:  "Run a script"
//      Input variable:  recordId  =  the trigger record's Airtable record ID
//    Set RUN_MODE = 'single' below.
//
// B. SWEEP — Scripting extension. Set RUN_MODE = 'all'. Re-links every
//    feedback record; run it after adding Sessions that were missing.
// ═══════════════════════════════════════════════════════════════════════

const RUN_MODE = 'single';        // 'single' for the automation, 'all' for a sweep

const feedbackTbl = base.getTable('Class Feedback');
const sessionsTbl = base.getTable('Sessions');

// ── Group Sessions by Program name, newest first ──────────────────────
const sessionQ = await sessionsTbl.selectRecordsAsync({ fields: ['Session', 'Date', 'Day', 'Program'] });
const sessionsByProgram = new Map();
for (const s of sessionQ.records) {
  const start = s.getCellValue('Date');
  if (!start) continue;
  const entry = { id: s.id, name: s.name, day: s.getCellValueAsString('Day'), start: new Date(start) };
  for (const p of s.getCellValue('Program') ?? []) {
    sessionsByProgram.set(p.name, [...(sessionsByProgram.get(p.name) ?? []), entry]);
  }
}
for (const list of sessionsByProgram.values()) list.sort((a, b) => b.start - a.start);

// "Level 2" → "Zouk L2"; anything else has no Program.
function programFor(cls) {
  const m = /^Level (\d+)$/.exec(cls);
  return m ? `Zouk L${m[1]}` : null;
}

// What the log calls the "feedback date": the Date the submitter gave, or
// when they submitted.
function feedbackDate(record) {
  const day = record.getCellValue('Date');
  if (day) return { day, label: day };
  const submitted = new Date(record.getCellValue('Submission Date'));
  return { submitted, label: `submitted ${submitted.toISOString()}` };
}

function sessionFor(record, { day, submitted, label }) {
  const program = programFor(record.getCellValueAsString('Class'));
  if (!program) {
    console.log(`${record.name}: feedback date ${label}, no Program for this class; left unlinked`);
    return null;
  }
  const sessions = sessionsByProgram.get(program) ?? [];
  const hit = day
    ? sessions.find(s => s.day === day)
    : sessions.find(s => s.start <= submitted);
  if (!hit) console.log(`${record.name}: feedback date ${label}, no ${program} session; left unlinked`);
  return hit ?? null;
}

const fields = ['Name', 'Class', 'Date', 'Submission Date', 'Session'];
const records = RUN_MODE === 'single'
  ? [await feedbackTbl.selectRecordAsync(input.config().recordId, { fields })]
  : (await feedbackTbl.selectRecordsAsync({ fields })).records;

const updates = [];
for (const r of records) {
  if (!r) continue;
  const date = feedbackDate(r);
  const session = sessionFor(r, date);
  if (!session) continue;
  const current = (r.getCellValue('Session') ?? []).map(s => s.id);
  const alreadyLinked = current.length === 1 && current[0] === session.id;
  console.log(`${r.name}: feedback date ${date.label} → ${session.name}${alreadyLinked ? ' (already linked)' : ''}`);
  if (!alreadyLinked) updates.push({ id: r.id, fields: { Session: [{ id: session.id }] } });
}

console.log(`Checked ${records.length} record(s); linking ${updates.length}.`);
while (updates.length) await feedbackTbl.updateRecordsAsync(updates.splice(0, 50));
