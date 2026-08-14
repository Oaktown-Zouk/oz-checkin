import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  checkins,
  memberships,
  membershipCharges,
  payments,
  promoCredits,
  students,
  studentEmails,
  waivers,
  type Student,
} from "../db/schema.js";
import { today } from "../lib/date.js";
import { broadcastChange } from "../lib/events.js";
import { NotFoundError } from "../lib/errors.js";

export interface CreditInfo {
  id: number;
  paidAt: string;
  amountCents: number;
  redeemed: boolean;
  // Set when this credit was bought by someone else and transferred (see
  // services/transfers.ts) — e.g. "Alice bought a pass, transferred it to Bob."
  purchasedByName: string | null;
}

// A membership charge this student PAID for but that now belongs to a different
// student's membership (transferred away — see services/transfers.ts). Shown on the
// payer's page/timeline so a transfer is visible from both sides, not just the
// recipient's — Givebutter itself has no concept of the transfer, so without this the
// payer's history would just look like the membership silently vanished.
export interface PaidForOtherInfo {
  studentId: number;
  studentName: string;
  amountCents: number;
  paidAt: string;
}

// A non-Givebutter credit, e.g. the free drop-in every new student is granted on
// creation (see lib/upsertStudent.ts). Spends through the same check-in flow as a real
// payment (see services/checkins.ts) but is kept in its own list here — separate from
// `payments` — since it isn't a real transaction and callers that pick a *specific*
// credit to redeem (the checkIn `paymentId` param) only ever mean a real payment.
export interface PromoCreditInfo {
  id: number;
  reason: string;
  grantedAt: string;
  redeemed: boolean;
}

export interface CheckInInfo {
  id: number;
  checkedInAt: string;
  checkedInBy: string | null;
  paymentId: number | null;
  promoCreditId: number | null;
}

export interface StudentStatus {
  id: number;
  name: string;
  email: string;
  // Dance level, 1-4, or null if unset — front desk-set, not sourced from a sync (see
  // routes/students.ts).
  leadLevel: number | null;
  followLevel: number | null;
  // Additional emails linked via a merge (see services/merge.ts) — shown so front desk
  // can see why a row combines a waiver and a payment history.
  alternateEmails: string[];
  waiver: { signed: boolean; signedAt: string | null };
  membership: {
    active: boolean;
    status: string;
    frequency: string | null;
    currentPeriodEnd: string | null;
    // Most recent charge billed against this plan, regardless of status. Shown
    // alongside a non-active (e.g. paused) membership so front desk can judge whether
    // the student already paid for the current month — deliberately not computed
    // programmatically (see schema.ts on membershipCharges for why).
    lastPaymentAt: string | null;
    // Whether THIS check-in should be treated as covered by the membership rather than
    // spending a credit: true if active, or if paused/etc. but paid within the last
    // MEMBERSHIP_GRACE_DAYS — pausing doesn't retroactively revoke a month already paid
    // for. Drives both the credits badge (hidden when covered — see StudentBadges) and
    // the actual spend decision in services/checkins.ts, from one place, so the two
    // can't drift out of sync with each other.
    coversCheckIn: boolean;
    // Set when someone else pays for this membership (transferred — see
    // services/transfers.ts), e.g. "Alice bought this membership for Bob."
    managedByName: string | null;
  } | null;
  // ALL memberships this student holds, not just the primary one shown above — a
  // student can genuinely hold more than one (that's the whole scenario transfers
  // exist for: someone buys a second membership for someone else). Used by the
  // transfer picker (see services/transfers.ts) so every held item is choosable, not
  // just the primary.
  heldMemberships: { id: number; status: string; frequency: string | null; amountCents: number | null }[];
  // available/total fold in both real payments and promo credits (e.g. the free
  // drop-in every new student gets) — front desk just needs "how many can they
  // spend," not which kind. The breakdown by kind is still exposed separately below
  // for the (currently server-internal) explicit-credit-selection path in checkins.ts.
  credits: {
    available: number;
    total: number;
    payments: CreditInfo[];
    promo: PromoCreditInfo[];
  } | null;
  // Membership charges this student paid for that are now held by a different
  // student's (transferred) membership — see PaidForOtherInfo.
  paidMembershipsForOthers: PaidForOtherInfo[];
  // "Today" here means the *viewed* date — callers can look at (and check in against)
  // a past date via listStudentStatuses'/createCheckIn's `date` param, defaulting to the
  // real today when omitted. Field names kept as -Today for minimal API churn; the
  // caller already knows which date it asked for.
  checkinsToday: CheckInInfo[];
  checkedInToday: boolean;
  // Whether a *next* check-in is currently possible: the first check-in of the (viewed)
  // day is always allowed; any check-in after that requires an unredeemed credit to spend.
  canCheckIn: boolean;
  requiresCreditToCheckIn: boolean;
  // Any real (non-undone) check-in ever, on ANY date — unlike checkedInToday this is not
  // scoped to the viewed date. Drives the "New Member" welcome badge only; it no longer
  // gates the free-drop-in promo, since that's now a real credit (see credits.promo)
  // that's either present and unredeemed or it isn't.
  everCheckedIn: boolean;
}

function isMembershipActive(status: string, currentPeriodEnd: Date | null): boolean {
  if (status.toLowerCase() !== "active") return false;
  if (currentPeriodEnd && currentPeriodEnd.getTime() < Date.now()) return false;
  return true;
}

const MEMBERSHIP_GRACE_DAYS = 30;

function membershipCoversCheckIn(active: boolean, lastPaymentAt: Date | null): boolean {
  if (active) return true;
  if (!lastPaymentAt) return false;
  const ageMs = Date.now() - lastPaymentAt.getTime();
  return ageMs <= MEMBERSHIP_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

function buildStatus(
  student: Student,
  waiverRows: (typeof waivers.$inferSelect)[],
  membershipRows: (typeof memberships.$inferSelect)[],
  membershipChargeRows: (typeof membershipCharges.$inferSelect)[],
  paymentRows: (typeof payments.$inferSelect)[],
  promoCreditRows: (typeof promoCredits.$inferSelect)[],
  allCheckinRows: (typeof checkins.$inferSelect)[],
  studentEmailRows: (typeof studentEmails.$inferSelect)[],
  nameById: Map<number, string>,
  viewedDate: string
): StudentStatus {
  const latestWaiver = waiverRows
    .filter((w) => w.studentId === student.id)
    .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())[0];

  // holderStudentId is who this belongs to for check-in/display purposes — starts equal
  // to studentId (the raw Givebutter payer) and only diverges after an explicit transfer
  // (see services/transfers.ts). Falls back to studentId defensively; in practice
  // holderStudentId is always populated once a row exists.
  const holderOf = (row: { studentId: number; holderStudentId: number | null }) =>
    row.holderStudentId ?? row.studentId;

  const studentMemberships = membershipRows.filter((m) => holderOf(m) === student.id);
  const activeMembership = studentMemberships.find((m) =>
    isMembershipActive(m.status, m.currentPeriodEnd)
  );
  const primaryMembership = activeMembership ?? studentMemberships[0];

  // "My" charges — for lastPaymentAt and the payment timeline — are the ones whose
  // charge is currently held by me, regardless of who actually paid.
  const heldMembershipCharges = membershipChargeRows.filter((c) => holderOf(c) === student.id);
  const primaryMembershipCharges = primaryMembership
    ? heldMembershipCharges.filter((c) => c.givebutterPlanId === primaryMembership.givebutterPlanId)
    : [];
  const lastPaymentAt = primaryMembershipCharges.length
    ? new Date(Math.max(...primaryMembershipCharges.map((c) => c.paidAt.getTime())))
    : null;
  const membershipIsActive = primaryMembership
    ? isMembershipActive(primaryMembership.status, primaryMembership.currentPeriodEnd)
    : false;
  const membershipCovers = primaryMembership
    ? membershipCoversCheckIn(membershipIsActive, lastPaymentAt)
    : false;
  const managedByName =
    primaryMembership && primaryMembership.studentId !== holderOf(primaryMembership)
      ? (nameById.get(primaryMembership.studentId) ?? null)
      : null;

  // Charges I paid for (studentId = me) whose membership is now held by someone else —
  // the payer's-side view of a transferred membership (see PaidForOtherInfo).
  const paidForOthersCharges = membershipChargeRows.filter(
    (c) => c.studentId === student.id && holderOf(c) !== student.id
  );

  const studentPayments = paymentRows.filter((p) => holderOf(p) === student.id);
  const unredeemedPayments = studentPayments.filter((p) => p.redeemedAt === null);

  const studentPromoCredits = promoCreditRows.filter((c) => c.studentId === student.id);
  const unredeemedPromoCredits = studentPromoCredits.filter((c) => c.redeemedAt === null);

  const studentAllCheckins = allCheckinRows.filter((c) => c.studentId === student.id);
  const studentCheckinsToday = studentAllCheckins.filter((c) => c.date === viewedDate);

  const checkedInToday = studentCheckinsToday.length > 0;
  const everCheckedIn = studentAllCheckins.length > 0;
  const creditsAvailable = unredeemedPayments.length + unredeemedPromoCredits.length;
  const requiresCreditToCheckIn = checkedInToday;
  const canCheckIn = !checkedInToday || creditsAvailable > 0;

  return {
    id: student.id,
    name: student.name,
    email: student.email,
    leadLevel: student.leadLevel,
    followLevel: student.followLevel,
    alternateEmails: studentEmailRows
      .filter((e) => e.studentId === student.id)
      .map((e) => e.email),
    waiver: {
      signed: Boolean(latestWaiver),
      signedAt: latestWaiver ? latestWaiver.signedAt.toISOString() : null,
    },
    membership: primaryMembership
      ? {
          active: membershipIsActive,
          status: primaryMembership.status,
          frequency: primaryMembership.frequency,
          currentPeriodEnd: primaryMembership.currentPeriodEnd
            ? primaryMembership.currentPeriodEnd.toISOString()
            : null,
          lastPaymentAt: lastPaymentAt ? lastPaymentAt.toISOString() : null,
          coversCheckIn: membershipCovers,
          managedByName,
        }
      : null,
    heldMemberships: studentMemberships.map((m) => ({
      id: m.id,
      status: m.status,
      frequency: m.frequency,
      amountCents: m.amountCents,
    })),
    credits:
      studentPayments.length > 0 || studentPromoCredits.length > 0
        ? {
            available: creditsAvailable,
            total: studentPayments.length + studentPromoCredits.length,
            payments: studentPayments
              .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
              .map((p) => ({
                id: p.id,
                paidAt: p.paidAt.toISOString(),
                amountCents: p.amountCents,
                redeemed: p.redeemedAt !== null,
                purchasedByName:
                  p.studentId !== holderOf(p) ? (nameById.get(p.studentId) ?? null) : null,
              })),
            promo: studentPromoCredits
              .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())
              .map((c) => ({
                id: c.id,
                reason: c.reason,
                grantedAt: c.grantedAt.toISOString(),
                redeemed: c.redeemedAt !== null,
              })),
          }
        : null,
    paidMembershipsForOthers: paidForOthersCharges
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
      .map((c) => ({
        studentId: holderOf(c),
        studentName: nameById.get(holderOf(c)) ?? "Unknown",
        amountCents: c.amountCents,
        paidAt: c.paidAt.toISOString(),
      })),
    checkinsToday: studentCheckinsToday
      .sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime())
      .map((c) => ({
        id: c.id,
        checkedInAt: c.checkedInAt.toISOString(),
        checkedInBy: c.checkedInBy,
        paymentId: c.paymentId,
        promoCreditId: c.promoCreditId,
      })),
    checkedInToday,
    canCheckIn,
    requiresCreditToCheckIn,
    everCheckedIn,
  };
}

export async function listStudentStatuses(
  opts: { query?: string; ids?: number[]; date?: string } = {}
): Promise<StudentStatus[]> {
  const conditions = [];
  if (opts.query) conditions.push(like(students.name, `%${opts.query}%`));
  if (opts.ids) conditions.push(inArray(students.id, opts.ids));

  const studentRows =
    conditions.length > 0
      ? await db
          .select()
          .from(students)
          .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      : await db.select().from(students);

  if (studentRows.length === 0) return [];

  const ids = studentRows.map((s) => s.id);
  const todayStr = opts.date ?? today();

  const [
    waiverRows,
    membershipRows,
    membershipChargeRows,
    paymentRows,
    promoCreditRows,
    allCheckinRows,
    studentEmailRows,
  ] = await Promise.all([
    db.select().from(waivers).where(inArray(waivers.studentId, ids)),
    // holderStudentId, not studentId — that's who a membership belongs to for app
    // purposes once it may have been transferred (see services/transfers.ts).
    db.select().from(memberships).where(inArray(memberships.holderStudentId, ids)),
    // Both directions: charges I currently hold (mine) AND charges I paid for that are
    // now held by someone else (surfaced via paidMembershipsForOthers) — see buildStatus.
    db
      .select()
      .from(membershipCharges)
      .where(or(inArray(membershipCharges.holderStudentId, ids), inArray(membershipCharges.studentId, ids))),
    db.select().from(payments).where(inArray(payments.holderStudentId, ids)),
    db.select().from(promoCredits).where(inArray(promoCredits.studentId, ids)),
    // Not date-filtered: buildStatus needs both the viewed day's check-ins and
    // whether the student has ANY real check-in ever (for the New Member badge).
    db
      .select()
      .from(checkins)
      .where(and(inArray(checkins.studentId, ids), isNull(checkins.undoneAt))),
    db.select().from(studentEmails).where(inArray(studentEmails.studentId, ids)),
  ]);

  // Names for anyone referenced as a payer/holder who isn't already in this batch (e.g.
  // viewing just Bob's row, but Alice paid for his membership) — needed for
  // managedByName/purchasedByName/paidMembershipsForOthers.
  const nameById = new Map<number, string>(studentRows.map((s) => [s.id, s.name]));
  const missingIds = new Set<number>();
  for (const m of membershipRows) if (!nameById.has(m.studentId)) missingIds.add(m.studentId);
  for (const p of paymentRows) if (!nameById.has(p.studentId)) missingIds.add(p.studentId);
  for (const c of membershipChargeRows) {
    if (!nameById.has(c.studentId)) missingIds.add(c.studentId);
    if (c.holderStudentId !== null && !nameById.has(c.holderStudentId)) missingIds.add(c.holderStudentId);
  }
  if (missingIds.size > 0) {
    const extraStudents = await db
      .select({ id: students.id, name: students.name })
      .from(students)
      .where(inArray(students.id, [...missingIds]));
    for (const s of extraStudents) nameById.set(s.id, s.name);
  }

  const statuses = studentRows.map((s) =>
    buildStatus(
      s,
      waiverRows,
      membershipRows,
      membershipChargeRows,
      paymentRows,
      promoCreditRows,
      allCheckinRows,
      studentEmailRows,
      nameById,
      todayStr
    )
  );

  // Not-checked-in-today first (alphabetical), checked-in-today sink to the bottom
  // (earliest check-in first).
  statuses.sort((a, b) => {
    if (a.checkedInToday !== b.checkedInToday) return a.checkedInToday ? 1 : -1;
    if (a.checkedInToday && b.checkedInToday) {
      return (a.checkinsToday[0]?.checkedInAt ?? "").localeCompare(
        b.checkinsToday[0]?.checkedInAt ?? ""
      );
    }
    return a.name.localeCompare(b.name);
  });

  return statuses;
}

export async function getStudentStatusById(id: number, date?: string): Promise<StudentStatus | null> {
  const [status] = await listStudentStatuses({ ids: [id], date });
  return status ?? null;
}

// level is 1-4 (validated by the caller — see routes/students.ts) or null to unset.
export async function updateStudentLevel(
  id: number,
  field: "leadLevel" | "followLevel",
  level: number | null
): Promise<StudentStatus> {
  const [existing] = await db.select({ id: students.id }).from(students).where(eq(students.id, id));
  if (!existing) throw new NotFoundError("Student not found");

  await db
    .update(students)
    .set({ [field]: level, updatedAt: new Date() })
    .where(eq(students.id, id));

  const updated = await getStudentStatusById(id);
  if (!updated) throw new NotFoundError("Student not found");
  broadcastChange("levels");
  return updated;
}
