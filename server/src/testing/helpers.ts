// Test-only utilities: an isolated in-memory DB per test file (node:test runs each file
// in its own process, so :memory: — set via .env.test — is naturally isolated) plus
// fixture builders for the tables these tests touch directly.
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../db/client.js";
import {
  checkins,
  givebutterContacts,
  memberships,
  membershipCharges,
  payments,
  students,
  studentEmails,
  syncState,
  waivers,
} from "../db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let migrated = false;

export function setupTestDb() {
  if (migrated) return;
  migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") });
  migrated = true;
}

export async function resetDb() {
  // Children before parents — node:sqlite enforces foreign keys by default.
  await db.delete(checkins);
  await db.delete(payments);
  await db.delete(membershipCharges);
  await db.delete(memberships);
  await db.delete(givebutterContacts);
  await db.delete(studentEmails);
  await db.delete(waivers);
  await db.delete(students);
  await db.delete(syncState);
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export async function insertStudent(
  email: string,
  name = "Test Student",
  nameSource: string | null = null
): Promise<number> {
  const [row] = await db.insert(students).values({ email, name, nameSource }).returning();
  return row.id;
}

export async function insertWaiver(
  studentId: number,
  opts: { signedAt?: Date; formResponseId?: string } = {}
): Promise<void> {
  await db.insert(waivers).values({
    studentId,
    formResponseId: opts.formResponseId ?? unique("resp"),
    signedAt: opts.signedAt ?? new Date(),
  });
}

export async function insertMembership(
  studentId: number,
  opts: {
    status?: string;
    currentPeriodEnd?: Date | null;
    planId?: string;
    frequency?: string;
    startedAt?: Date | null;
    canceledAt?: Date | null;
  } = {}
): Promise<number> {
  const [row] = await db
    .insert(memberships)
    .values({
      studentId,
      givebutterPlanId: opts.planId ?? unique("plan"),
      status: opts.status ?? "active",
      frequency: opts.frequency ?? "monthly",
      currentPeriodEnd: opts.currentPeriodEnd ?? null,
      startedAt: opts.startedAt ?? null,
      canceledAt: opts.canceledAt ?? null,
    })
    .returning();
  return row.id;
}

export async function insertPayment(
  studentId: number,
  opts: { amountCents?: number; redeemed?: boolean; paidAt?: Date; txId?: string } = {}
): Promise<number> {
  const [row] = await db
    .insert(payments)
    .values({
      studentId,
      givebutterTransactionId: opts.txId ?? unique("txn"),
      amountCents: opts.amountCents ?? 2000,
      paidAt: opts.paidAt ?? new Date(),
      redeemedAt: opts.redeemed ? new Date() : null,
    })
    .returning();
  return row.id;
}

export async function insertMembershipCharge(
  studentId: number,
  planId: string,
  opts: { amountCents?: number; paidAt?: Date; txId?: string } = {}
): Promise<number> {
  const [row] = await db
    .insert(membershipCharges)
    .values({
      studentId,
      givebutterPlanId: planId,
      givebutterTransactionId: opts.txId ?? unique("txn"),
      amountCents: opts.amountCents ?? 16500,
      paidAt: opts.paidAt ?? new Date(),
    })
    .returning();
  return row.id;
}

export async function insertStudentEmail(studentId: number, email: string): Promise<void> {
  await db.insert(studentEmails).values({ studentId, email });
}

export async function insertGivebutterContact(studentId: number, contactId?: string): Promise<void> {
  await db.insert(givebutterContacts).values({
    studentId,
    givebutterContactId: contactId ?? unique("contact"),
  });
}

export async function insertCheckin(
  studentId: number,
  opts: { date?: string; paymentId?: number | null; undoneAt?: Date | null; checkedInAt?: Date } = {}
): Promise<number> {
  const { today } = await import("../lib/date.js");
  const [row] = await db
    .insert(checkins)
    .values({
      studentId,
      date: opts.date ?? today(),
      checkedInBy: "test",
      paymentId: opts.paymentId ?? null,
      undoneAt: opts.undoneAt ?? null,
      ...(opts.checkedInAt ? { checkedInAt: opts.checkedInAt } : {}),
    })
    .returning();
  return row.id;
}
