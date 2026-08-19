// One-time Phase 3 migration: moves what the old SQLite-backed app owned that Airtable
// doesn't already have — dance levels (lead_level/follow_level) and check-in history —
// into the new Airtable base. Matches SQLite `students` to Airtable `Members` by
// normalized email. Everything else (payments, memberships, contacts) already lives in
// Airtable via its own Givebutter sync and isn't touched here.
//
// Dry run by default — prints exactly what it would do without writing anything.
// Pass --apply to actually write. Safe to re-run: level updates are idempotent, and
// check-in creation is the only non-idempotent part (re-running with --apply after a
// partial success would duplicate check-ins already created — see the printed log
// path for the exact records created, if you need to clean up and retry).
//
// Deliberately NOT migrated: the old payment/promo-credit redemption ledger. The new
// Credits table's automations regenerate credit state from Airtable's own current
// Transactions/Members going forward; there's no clean way to backfill "which old
// SQLite payment redeemed which old check-in" into that model, and it wasn't asked
// for. One known consequence worth flagging separately: Automation A (grant a credit
// to a new Member) only fires on record *creation*, so the ~75 members already in
// Airtable before this session never got a "New Member" credit grant retroactively.

import { writeFileSync } from "node:fs";
import { db, sqlite } from "../db/client.js";
import { students, checkins } from "../db/schema.js";
import { listRecords, updateRecord, createRecords, TABLES } from "../airtable/client.js";
import { normalizeEmail } from "../lib/date.js";
import type { MemberFields, CheckinFields } from "../airtable/fields.js";

// `student_emails` (alternate emails linked by the old merge feature) was dropped from
// the Drizzle schema in Phase 1 but never actually deleted from the SQLite file — it's
// still there. Turned out to matter: several students' *primary* email was the old
// Google Forms one, while the alternate (linked via a merge, back when Forms and
// Givebutter were separate identity sources) is what Givebutter — and so Airtable —
// actually has on file. Queried directly since it's not part of the current schema.
interface AltEmailRow {
  student_id: number;
  email: string;
}

function loadAltEmailsByStudentId(): Map<number, string[]> {
  const rows = sqlite.prepare("SELECT student_id, email FROM student_emails").all() as unknown as AltEmailRow[];
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const list = map.get(r.student_id) ?? [];
    list.push(r.email);
    map.set(r.student_id, list);
  }
  return map;
}

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 10; // Airtable's batch-create limit

async function main() {
  console.log(APPLY ? "Running for real (--apply passed).\n" : "DRY RUN — pass --apply to actually write.\n");

  const sqliteStudents = await db.select().from(students);
  const sqliteCheckins = await db.select().from(checkins);

  const airtableMembers = await listRecords<MemberFields>(TABLES.members, {
    fields: ["Email"],
  });
  const airtableIdByEmail = new Map<string, string>();
  for (const m of airtableMembers) {
    if (m.fields.Email) airtableIdByEmail.set(normalizeEmail(m.fields.Email), m.id);
  }

  const checkinsByStudentId = new Map<number, typeof sqliteCheckins>();
  for (const c of sqliteCheckins) {
    const list = checkinsByStudentId.get(c.studentId) ?? [];
    list.push(c);
    checkinsByStudentId.set(c.studentId, list);
  }

  const altEmailsByStudentId = loadAltEmailsByStudentId();

  const matched: {
    sqliteId: number;
    airtableId: string;
    email: string;
    matchedVia: "primary" | "alternate";
    leadLevel: number | null;
    followLevel: number | null;
  }[] = [];
  const unmatched: { email: string; name: string; leadLevel: number | null; followLevel: number | null; checkinCount: number }[] = [];

  for (const s of sqliteStudents) {
    let airtableId = airtableIdByEmail.get(normalizeEmail(s.email));
    let matchedVia: "primary" | "alternate" = "primary";
    let matchedEmail = s.email;

    if (!airtableId) {
      for (const alt of altEmailsByStudentId.get(s.id) ?? []) {
        const found = airtableIdByEmail.get(normalizeEmail(alt));
        if (found) {
          airtableId = found;
          matchedVia = "alternate";
          matchedEmail = alt;
          break;
        }
      }
    }

    if (airtableId) {
      matched.push({ sqliteId: s.id, airtableId, email: matchedEmail, matchedVia, leadLevel: s.leadLevel, followLevel: s.followLevel });
    } else {
      unmatched.push({
        email: s.email,
        name: s.name,
        leadLevel: s.leadLevel,
        followLevel: s.followLevel,
        checkinCount: (checkinsByStudentId.get(s.id) ?? []).length,
      });
    }
  }

  const viaAlternate = matched.filter((m) => m.matchedVia === "alternate");
  if (viaAlternate.length > 0) {
    console.log(`${viaAlternate.length} matched via an alternate (student_emails) email, not their primary:`);
    for (const m of viaAlternate) console.log(`  - matched via ${m.email}`);
  }

  console.log(`${matched.length} of ${sqliteStudents.length} SQLite students matched an Airtable Member by email.`);
  if (unmatched.length > 0) {
    console.log(`${unmatched.length} unmatched — their levels/check-ins CANNOT be migrated (no Airtable Member to attach to):`);
    for (const u of unmatched) {
      const level = u.leadLevel !== null || u.followLevel !== null ? "has a level set" : "no level set";
      console.log(`  - ${u.name} <${u.email}> — ${level}, ${u.checkinCount} check-in(s)`);
    }
  }

  const levelUpdates = matched.filter((m) => m.leadLevel !== null || m.followLevel !== null);
  const matchedIds = new Set(matched.map((m) => m.sqliteId));
  const checkinsToMigrate = sqliteCheckins.filter((c) => matchedIds.has(c.studentId));
  const undoneCount = checkinsToMigrate.filter((c) => c.undoneAt !== null).length;

  console.log(`\n${levelUpdates.length} matched students have a dance level to write.`);
  console.log(
    `${checkinsToMigrate.length} of ${sqliteCheckins.length} check-ins belong to a matched student and will be created ` +
      `(${undoneCount} of those are already-undone corrections, preserved as such).`
  );

  if (!APPLY) {
    console.log("\nDry run only — no writes made. Re-run with --apply to write these changes.");
    return;
  }

  const log = {
    levelUpdates: [] as { airtableId: string; email: string; leadLevel: number | null; followLevel: number | null }[],
    createdCheckinIds: [] as string[],
  };

  for (const m of levelUpdates) {
    const fields: Partial<MemberFields> = {};
    if (m.leadLevel !== null) fields["Lead Level"] = m.leadLevel;
    if (m.followLevel !== null) fields["Follow Level"] = m.followLevel;
    await updateRecord<MemberFields>(TABLES.members, m.airtableId, fields);
    log.levelUpdates.push({ airtableId: m.airtableId, email: m.email, leadLevel: m.leadLevel, followLevel: m.followLevel });
  }
  console.log(`\nUpdated ${levelUpdates.length} members' dance levels.`);

  const airtableIdBySqliteId = new Map(matched.map((m) => [m.sqliteId, m.airtableId]));
  let created = 0;
  for (let i = 0; i < checkinsToMigrate.length; i += BATCH_SIZE) {
    const batch = checkinsToMigrate.slice(i, i + BATCH_SIZE);
    const records = await createRecords<CheckinFields>(
      TABLES.checkins,
      batch.map((c) => {
        const fields: Partial<CheckinFields> = {
          Member: [airtableIdBySqliteId.get(c.studentId)!],
          "Checked In At": c.checkedInAt.toISOString(),
          Method: "Staff",
        };
        if (c.undoneAt) fields["Undone At"] = c.undoneAt.toISOString();
        return fields;
      })
    );
    created += records.length;
    log.createdCheckinIds.push(...records.map((r) => r.id));
    console.log(`  created ${created}/${checkinsToMigrate.length} check-ins...`);
  }

  const logPath = `./migration-log-${Date.now()}.json`;
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\nDone. ${levelUpdates.length} levels updated, ${created} check-ins created.`);
  console.log(`Log written to ${logPath} (Airtable record ids, for auditing or manual rollback).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
