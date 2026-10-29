// ═══════════════════════════════════════════════════════════════════════
// Suspensions → Members :: LINK MATCHING MEMBERS
//
// Links every unlifted Suspension (Lifted On blank) to each Member whose
// first + last name equals its name (or a line of Other Names), ignoring
// case, accents, punctuation, and spacing — so a suspended person is blocked
// under any Member record they turn up as, including one created long after
// the suspension. Each new link ticks Needs Review so staff can confirm it's
// the same person; a wrong match is undone by unlinking that Member by hand.
// This script only ever adds links, never removes one.
//
// Every run re-checks everything (Suspensions are few), so the same script
// serves all three triggers:
//   - Members: "When record created", and "When record updated" watching
//     First Name, Last Name
//   - Suspensions: "When record created", and "When record updated"
//     watching First Name, Last Name, Other Names, Lifted On
//   - Scripting extension, ad hoc
// No input variables needed.
// ═══════════════════════════════════════════════════════════════════════

const WRITE_BATCH_SIZE = 50; // Airtable's per-call update limit

// ═══ END CONFIG ═══

const membersTable = base.getTable('Members');
const suspensionsTable = base.getTable('Suspensions');

const suspensionQuery = await suspensionsTable.selectRecordsAsync({
  fields: ['First Name', 'Last Name', 'Other Names', 'Member', 'Lifted On'],
});
const active = suspensionQuery.records.filter((s) => !s.getCellValue('Lifted On'));

if (active.length === 0) {
  console.log('No unlifted suspensions — nothing to link.');
} else {
  const memberQuery = await membersTable.selectRecordsAsync({
    fields: ['First Name', 'Last Name'],
  });
  const members = memberQuery.records.map((m) => ({
    id: m.id,
    name: `${m.getCellValueAsString('First Name')} ${m.getCellValueAsString('Last Name')}`.trim(),
    person: {
      firstName: m.getCellValueAsString('First Name'),
      lastName: m.getCellValueAsString('Last Name'),
    },
  }));

  const updates = [];
  for (const s of active) {
    const person = {
      firstName: s.getCellValueAsString('First Name'),
      lastName: s.getCellValueAsString('Last Name'),
      otherNames: s.getCellValueAsString('Other Names'),
    };
    const linked = (s.getCellValue('Member') ?? []).map((l) => l.id);
    const linkedSet = new Set(linked);

    const added = [];
    for (const m of members) {
      if (linkedSet.has(m.id) || !matchesSuspension(person, m.person)) continue;
      added.push(m.id);
      console.log(`Linking ${s.getCellValueAsString('First Name')} ${s.getCellValueAsString('Last Name')} (${s.id}) → ${m.name} (${m.id})`);
    }
    if (added.length === 0) continue;

    updates.push({
      id: s.id,
      fields: {
        Member: [...linked, ...added].map((id) => ({ id })),
        'Needs Review': true,
      },
    });
  }

  for (let i = 0; i < updates.length; i += WRITE_BATCH_SIZE) {
    await suspensionsTable.updateRecordsAsync(updates.slice(i, i + WRITE_BATCH_SIZE));
  }
  console.log(`Checked ${active.length} unlifted suspension(s) against ${members.length} member(s); updated ${updates.length}.`);
}
