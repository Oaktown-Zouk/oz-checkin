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
    phone: text("phone"),
    // Dance level, 1-4, or null if unset — front desk sets these manually (see
    // routes/students.ts); not sourced from Forms or Givebutter.
    leadLevel: integer("lead_level"),
    followLevel: integer("follow_level"),
    ...timestamps,
  },
  (t) => ({
    emailIdx: uniqueIndex("students_email_idx").on(t.email),
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
    // Raw Givebutter attribution — whoever's contact/email is on the transaction.
    // Refreshed freely by sync; never touched by our own app logic. Kept mainly for
    // provenance ("who actually paid") once holderStudentId has been transferred away.
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    // Who this credit currently belongs to for check-in/display purposes. Starts equal
    // to studentId at creation; sync never touches it again once set. The only thing
    // that changes it is an explicit transfer (see services/transfers.ts) — this is
    // what lets "Alice bought a pass for Bob" actually redeem against Bob's check-in.
    holderStudentId: integer("holder_student_id").references(() => students.id),
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
    // Raw Givebutter attribution — see payments.studentId above for the same split.
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    // Who currently holds this membership for check-in/display purposes — see
    // payments.holderStudentId above. Transferable via services/transfers.ts.
    holderStudentId: integer("holder_student_id").references(() => students.id),
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

// Historical record of charges billed against a recurring membership plan (the initial
// charge and every renewal) — NOT a redeemable credit like `payments`; the matching
// `memberships` row already represents that student's access. This exists purely so
// front desk can see when a member last actually paid, which matters once a plan is
// paused: pausing doesn't retroactively revoke the month they already paid for, and we
// deliberately don't try to compute "is this payment good for the currently-viewed
// month" here — that logic gets fuzzy fast, so we just show the date and let a human
// judge it (see services/studentStatus.ts, services/studentTimeline.ts).
export const membershipCharges = sqliteTable(
  "membership_charges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Raw Givebutter attribution — each charge transaction always carries the original
    // payer's contact, even after the membership itself has been transferred (Givebutter
    // has no concept of our transfer). See payments.studentId for the same split.
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    // Whoever currently holds the membership this charge paid for — copied from
    // memberships.holderStudentId at sync time (see services/givebutter.ts), not from
    // this transaction's own contact. This is what makes a transferred membership's
    // *future* charges automatically follow the new holder, and (combined with
    // studentId) is what lets a charge show on both the payer's and the holder's page.
    holderStudentId: integer("holder_student_id").references(() => students.id),
    givebutterPlanId: text("givebutter_plan_id").notNull(),
    givebutterTransactionId: text("givebutter_transaction_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidAt: integer("paid_at", { mode: "timestamp" }).notNull(),
    ...timestamps,
  },
  (t) => ({
    transactionIdx: uniqueIndex("membership_charges_transaction_idx").on(t.givebutterTransactionId),
  })
);

// A non-Givebutter redeemable credit — e.g. the one free drop-in every new student gets.
// Deliberately a separate table from `payments` rather than a $0 synthetic transaction:
// `payments` represents real money that came in from Givebutter, and a promo credit
// isn't that — mixing them would make "total revenue"-style queries against `payments`
// wrong. Shares the same redeemedAt/redeemedByCheckinId redemption shape as `payments`
// so both can be spent through the same check-in flow (see services/checkins.ts).
export const promoCredits = sqliteTable(
  "promo_credits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id),
    reason: text("reason").notNull(), // e.g. "new_student" — the policy that granted it
    grantedAt: integer("granted_at", { mode: "timestamp" }).notNull(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
    redeemedByCheckinId: integer("redeemed_by_checkin_id"),
    ...timestamps,
  },
  (t) => ({
    // One grant per reason per student — guards against a double-grant bug (e.g. a
    // retried student-creation race, or a future backfill script run twice).
    studentReasonIdx: uniqueIndex("promo_credits_student_reason_idx").on(t.studentId, t.reason),
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
  // Mutually exclusive with paymentId — at most one of the two is set, depending on
  // which kind of credit this check-in spent (see services/checkins.ts).
  promoCreditId: integer("promo_credit_id"),
  undoneAt: integer("undone_at", { mode: "timestamp" }),
});

export const syncState = sqliteTable("sync_state", {
  source: text("source").primaryKey(), // 'google_forms' | 'givebutter'
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  cursor: text("cursor"),
});

export type Student = typeof students.$inferSelect;
export type GivebutterContact = typeof givebutterContacts.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipCharge = typeof membershipCharges.$inferSelect;
export type PromoCredit = typeof promoCredits.$inferSelect;
export type CheckIn = typeof checkins.$inferSelect;
export type SyncState = typeof syncState.$inferSelect;
