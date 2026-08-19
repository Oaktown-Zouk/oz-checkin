// Phase 3 follow-up: migrates the old SQLite `payments` (one-time drop-in purchases)
// and `promo_credits` (the old "first drop-in free" grant) into Airtable's `Credits`
// table — including correctly marking which ones were already consumed, linked to the
// exact `Check-ins` record that consumed them.
//
// Run AFTER migrateToAirtable.ts (check-ins/levels) — this script resolves each
// redemption by looking up the already-migrated Check-ins record by (Member, Checked
// In At), so it depends on those existing first.
//
// Why this can't be done by re-running check-ins through the Credits automations
// instead: Automation C (the one that consumes a credit at check-in time) only fires
// for check-ins whose Checked In At is literally today — every migrated check-in is
// historical, so automations would never touch them. This script reconstructs the
// exact historical grant→redemption pairing directly from the old data instead, which
// is also more faithful than re-deriving it via the "oldest available credit" rule.
//
// Dry run by default — pass --apply to write. Safe to re-run in dry-run mode any
// number of times; --apply creates new records each time, so don't re-run --apply
// without cleaning up first (see the printed log path).

import { writeFileSync } from "node:fs";
import { db, sqlite } from "../db/client.js";
import { students, payments, promoCredits } from "../db/schema.js";
import { listRecords, createRecords, TABLES } from "../airtable/client.js";
import { normalizeEmail } from "../lib/date.js";
import type { MemberFields, CheckinFields, CreditFields, TransactionFields } from "../airtable/fields.js";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 10;

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

async function main() {
  console.log(APPLY ? "Running for real (--apply passed).\n" : "DRY RUN — pass --apply to actually write.\n");

  const sqliteStudents = await db.select().from(students);
  const sqlitePayments = await db.select().from(payments);
  const sqlitePromo = await db.select().from(promoCredits);
  // Raw query — `checkins` is still in the Drizzle schema, but we need the *old*
  // integer id -> (studentId, checkedInAt) mapping to resolve redemptions, which the
  // app's own tables no longer need post-migration.
  const sqliteCheckins = sqlite
    .prepare("SELECT id, student_id, checked_in_at FROM checkins")
    .all() as unknown as { id: number; student_id: number; checked_in_at: number }[];
  const oldCheckinById = new Map(sqliteCheckins.map((c) => [c.id, c]));

  const [airtableMembers, airtableCheckins, airtableTransactions] = await Promise.all([
    listRecords<MemberFields>(TABLES.members, { fields: ["Email"] }),
    listRecords<CheckinFields>(TABLES.checkins, { fields: ["Member", "Checked In At"] }),
    listRecords<TransactionFields>(TABLES.transactions, { fields: ["Transaction ID"] }),
  ]);

  const airtableIdByEmail = new Map<string, string>();
  for (const m of airtableMembers) {
    if (m.fields.Email) airtableIdByEmail.set(normalizeEmail(m.fields.Email), m.id);
  }
  const altEmailsByStudentId = loadAltEmailsByStudentId();

  function resolveAirtableId(sqliteStudentId: number): string | undefined {
    const s = sqliteStudents.find((st) => st.id === sqliteStudentId);
    if (!s) return undefined;
    const direct = airtableIdByEmail.get(normalizeEmail(s.email));
    if (direct) return direct;
    for (const alt of altEmailsByStudentId.get(s.id) ?? []) {
      const found = airtableIdByEmail.get(normalizeEmail(alt));
      if (found) return found;
    }
    return undefined;
  }

  // Keyed by `${memberId}|${checkedInAtISO}` — exact match, since migrateToAirtable.ts
  // preserved original timestamps verbatim.
  const checkinIdByMemberAndTime = new Map<string, string>();
  for (const c of airtableCheckins) {
    const memberId = c.fields.Member?.[0];
    const at = c.fields["Checked In At"];
    if (memberId && at) checkinIdByMemberAndTime.set(`${memberId}|${at}`, c.id);
  }

  const transactionIdByGivebutterId = new Map<string, string>();
  for (const t of airtableTransactions) {
    if (t.fields["Transaction ID"]) transactionIdByGivebutterId.set(t.fields["Transaction ID"], t.id);
  }

  function resolveConsumedCheckin(memberId: string, oldCheckinId: number | null): string | undefined {
    if (oldCheckinId === null) return undefined;
    const old = oldCheckinById.get(oldCheckinId);
    if (!old) return undefined;
    const iso = new Date(old.checked_in_at * 1000).toISOString();
    return checkinIdByMemberAndTime.get(`${memberId}|${iso}`);
  }

  type PlannedCredit = {
    fields: Partial<CreditFields>;
    summary: string;
  };
  const planned: PlannedCredit[] = [];
  const unmatched: { kind: "payment" | "promo"; email: string; amountOrReason: string; redeemed: boolean }[] = [];

  for (const p of sqlitePayments) {
    const holderId = p.holderStudentId ?? p.studentId;
    const memberId = resolveAirtableId(holderId);
    const payerId = resolveAirtableId(p.studentId);
    const holderEmail = sqliteStudents.find((s) => s.id === holderId)?.email ?? "?";
    if (!memberId) {
      unmatched.push({ kind: "payment", email: holderEmail, amountOrReason: `$${(p.amountCents / 100).toFixed(2)}`, redeemed: p.redeemedAt !== null });
      continue;
    }
    const fields: Partial<CreditFields> = {
      Member: [memberId],
      "Purchased By": [payerId ?? memberId],
      Reason: "Drop-in Purchase",
      "Granted At": p.paidAt.toISOString(),
    };
    const txnId = transactionIdByGivebutterId.get(p.givebutterTransactionId);
    if (txnId) fields["Source Transaction"] = [txnId];
    if (p.redeemedAt) {
      fields["Consumed At"] = p.redeemedAt.toISOString();
      const consumedCheckin = resolveConsumedCheckin(memberId, p.redeemedByCheckinId);
      if (consumedCheckin) fields["Consumed By Check-in"] = [consumedCheckin];
      else console.log(`  ! payment for ${holderEmail}: redeemed but couldn't find its matching new Check-in — leaving unconsumed.`);
    }
    planned.push({ fields, summary: `payment for ${holderEmail} ($${(p.amountCents / 100).toFixed(2)}, ${p.redeemedAt ? "redeemed" : "available"})` });
  }

  for (const pc of sqlitePromo) {
    const memberId = resolveAirtableId(pc.studentId);
    const email = sqliteStudents.find((s) => s.id === pc.studentId)?.email ?? "?";
    if (!memberId) {
      unmatched.push({ kind: "promo", email, amountOrReason: pc.reason, redeemed: pc.redeemedAt !== null });
      continue;
    }
    const fields: Partial<CreditFields> = {
      Member: [memberId],
      "Purchased By": [memberId],
      Reason: pc.reason === "new_student" ? "New Member" : "Comp",
      "Granted At": pc.grantedAt.toISOString(),
    };
    if (pc.redeemedAt) {
      fields["Consumed At"] = pc.redeemedAt.toISOString();
      const consumedCheckin = resolveConsumedCheckin(memberId, pc.redeemedByCheckinId);
      if (consumedCheckin) fields["Consumed By Check-in"] = [consumedCheckin];
      else console.log(`  ! promo credit for ${email}: redeemed but couldn't find its matching new Check-in — leaving unconsumed.`);
    }
    planned.push({ fields, summary: `promo credit for ${email} (${pc.reason}, ${pc.redeemedAt ? "redeemed" : "available"})` });
  }

  console.log(`\n${planned.length} credits will be created (${sqlitePayments.length} payments + ${sqlitePromo.length} promo credits considered).`);
  const consumedCount = planned.filter((p) => p.fields["Consumed At"]).length;
  console.log(`  ${consumedCount} already consumed (linked to their original check-in where found), ${planned.length - consumedCount} still available.`);

  if (unmatched.length > 0) {
    console.log(`\n${unmatched.length} credits CANNOT be migrated (owner has no Airtable Member):`);
    for (const u of unmatched) {
      console.log(`  - ${u.kind} <${u.email}> — ${u.amountOrReason}, ${u.redeemed ? "already redeemed" : "still available"}`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run only — no writes made. Re-run with --apply to write these changes.");
    return;
  }

  const log: { createdCreditIds: string[] } = { createdCreditIds: [] };
  let created = 0;
  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const batch = planned.slice(i, i + BATCH_SIZE);
    const records = await createRecords<CreditFields>(TABLES.credits, batch.map((p) => p.fields));
    created += records.length;
    log.createdCreditIds.push(...records.map((r) => r.id));
    console.log(`  created ${created}/${planned.length} credits...`);
  }

  const logPath = `./migration-credits-log-${Date.now()}.json`;
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\nDone. ${created} credits created.`);
  console.log(`Log written to ${logPath}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
