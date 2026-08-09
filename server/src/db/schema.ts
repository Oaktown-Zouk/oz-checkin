import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
};

export const students = sqliteTable(
  "students",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // normalized: lowercased + trimmed. This is the cross-system identity key.
    email: text("email").notNull(),
    name: text("name").notNull(),
    // Which source last set `name` — 'givebutter' | 'google_forms' | null. Givebutter
    // names are payment-processor-verified (checked against a credit card); Forms names
    // are free text. Once a name has been set by Givebutter, a later Forms sync must not
    // downgrade it — see lib/upsertStudent.ts.
    nameSource: text("name_source"),
    phone: text("phone"),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("students_email_idx").on(t.email),
  })
);

// Alternate emails for a student, beyond their primary `students.email` — e.g. someone
// who signed the waiver with a personal address but paid via Givebutter with a work
// address. Populated by merges (see services/merge.ts); consulted by sync so future
// Forms/Givebutter fetches recognize the alternate email as already-known instead of
// recreating the duplicate that was just merged away.
export const studentEmails = sqliteTable(
  "student_emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    email: text("email").notNull(),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("student_emails_email_idx").on(t.email),
  })
);

export const waivers = sqliteTable(
  "waivers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    formResponseId: text("form_response_id").notNull(),
    signedAt: integer("signed_at", { mode: "timestamp" }).notNull(),
    rawJson: text("raw_json"),
    ...timestamps,
  },
  (t) => ({
    formResponseIdx: uniqueIndex("waivers_form_response_idx").on(t.formResponseId),
  })
);

export const givebutterContacts = sqliteTable(
  "givebutter_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    givebutterContactId: text("givebutter_contact_id").notNull(),
    ...timestamps,
  },
  (t) => ({
    contactIdx: uniqueIndex("givebutter_contacts_contact_idx").on(t.givebutterContactId),
  })
);

// A one-time payment. Each successful transaction is a redeemable "class credit"
// until it's linked to a check-in.
export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    givebutterTransactionId: text("givebutter_transaction_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidAt: integer("paid_at", { mode: "timestamp" }).notNull(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
    redeemedByCheckinId: integer("redeemed_by_checkin_id"),
    ...timestamps,
  },
  (t) => ({
    transactionIdx: uniqueIndex("payments_transaction_idx").on(t.givebutterTransactionId),
  })
);

// A recurring donation/membership plan. "Active" == good for the current period;
// doesn't get consumed by check-in.
export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    givebutterPlanId: text("givebutter_plan_id").notNull(),
    status: text("status").notNull(), // raw status string from Givebutter (e.g. "active", "failing", "cancelled")
    frequency: text("frequency"),
    amountCents: integer("amount_cents"),
    // Not all Givebutter plan responses expose a period-end date; when absent this
    // is derived from status alone (active == good for now). See sync service.
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
    // From Givebutter's start_at/canceled_at — real event timestamps for the student
    // timeline (services/studentTimeline.ts), distinct from our own created_at/updated_at
    // (which only reflect when *we* first synced/last touched this row).
    startedAt: integer("started_at", { mode: "timestamp" }),
    canceledAt: integer("canceled_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (t) => ({
    planIdx: uniqueIndex("memberships_plan_idx").on(t.givebutterPlanId),
  })
);

export const checkins = sqliteTable("checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id")
    .notNull()
    .references(() => students.id),
  // YYYY-MM-DD, local studio time. No unique(studentId, date): one-time payers can
  // check in once per unredeemed credit in a day; recurring members are capped at
  // one per day by application logic in services/checkins.ts, not a DB constraint.
  date: text("date").notNull(),
  checkedInAt: integer("checked_in_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  checkedInBy: text("checked_in_by"),
  paymentId: integer("payment_id"),
  undoneAt: integer("undone_at", { mode: "timestamp" }),
});

export const syncState = sqliteTable("sync_state", {
  source: text("source").primaryKey(), // 'google_forms' | 'givebutter'
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  cursor: text("cursor"),
});

export type Student = typeof students.$inferSelect;
export type StudentEmail = typeof studentEmails.$inferSelect;
export type Waiver = typeof waivers.$inferSelect;
export type GivebutterContact = typeof givebutterContacts.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type CheckIn = typeof checkins.$inferSelect;
export type SyncState = typeof syncState.$inferSelect;
