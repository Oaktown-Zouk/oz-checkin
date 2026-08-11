import { and, inArray, isNull, like } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  checkins,
  memberships,
  membershipCharges,
  payments,
  students,
  studentEmails,
  waivers,
  type Student,
} from "../db/schema.js";
import { today } from "../lib/date.js";

export interface CreditInfo {
  id: number;
  paidAt: string;
  amountCents: number;
  redeemed: boolean;
}

export interface CheckInInfo {
  id: number;
  checkedInAt: string;
  checkedInBy: string | null;
  paymentId: number | null;
}

export interface StudentStatus {
  id: number;
  name: string;
  email: string;
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
  } | null;
  credits: { available: number; total: number; payments: CreditInfo[] } | null;
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
  // scoped to the viewed date. Used to gate the one-time "first class free" promo: it
  // shouldn't reappear for someone who used it on a different day than the one you
  // happen to be viewing.
  everCheckedIn: boolean;
}

function isMembershipActive(status: string, currentPeriodEnd: Date | null): boolean {
  if (status.toLowerCase() !== "active") return false;
  if (currentPeriodEnd && currentPeriodEnd.getTime() < Date.now()) return false;
  return true;
}

function buildStatus(
  student: Student,
  waiverRows: (typeof waivers.$inferSelect)[],
  membershipRows: (typeof memberships.$inferSelect)[],
  membershipChargeRows: (typeof membershipCharges.$inferSelect)[],
  paymentRows: (typeof payments.$inferSelect)[],
  allCheckinRows: (typeof checkins.$inferSelect)[],
  studentEmailRows: (typeof studentEmails.$inferSelect)[],
  viewedDate: string
): StudentStatus {
  const latestWaiver = waiverRows
    .filter((w) => w.studentId === student.id)
    .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())[0];

  const studentMemberships = membershipRows.filter((m) => m.studentId === student.id);
  const activeMembership = studentMemberships.find((m) =>
    isMembershipActive(m.status, m.currentPeriodEnd)
  );
  const primaryMembership = activeMembership ?? studentMemberships[0];

  const primaryMembershipCharges = primaryMembership
    ? membershipChargeRows.filter((c) => c.givebutterPlanId === primaryMembership.givebutterPlanId)
    : [];
  const lastPaymentAt = primaryMembershipCharges.length
    ? new Date(Math.max(...primaryMembershipCharges.map((c) => c.paidAt.getTime())))
    : null;

  const studentPayments = paymentRows.filter((p) => p.studentId === student.id);
  const unredeemed = studentPayments.filter((p) => p.redeemedAt === null);

  const studentAllCheckins = allCheckinRows.filter((c) => c.studentId === student.id);
  const studentCheckinsToday = studentAllCheckins.filter((c) => c.date === viewedDate);

  const checkedInToday = studentCheckinsToday.length > 0;
  const everCheckedIn = studentAllCheckins.length > 0;
  const creditsAvailable = unredeemed.length;
  const requiresCreditToCheckIn = checkedInToday;
  const canCheckIn = !checkedInToday || creditsAvailable > 0;

  return {
    id: student.id,
    name: student.name,
    email: student.email,
    alternateEmails: studentEmailRows
      .filter((e) => e.studentId === student.id)
      .map((e) => e.email),
    waiver: {
      signed: Boolean(latestWaiver),
      signedAt: latestWaiver ? latestWaiver.signedAt.toISOString() : null,
    },
    membership: primaryMembership
      ? {
          active: isMembershipActive(primaryMembership.status, primaryMembership.currentPeriodEnd),
          status: primaryMembership.status,
          frequency: primaryMembership.frequency,
          currentPeriodEnd: primaryMembership.currentPeriodEnd
            ? primaryMembership.currentPeriodEnd.toISOString()
            : null,
          lastPaymentAt: lastPaymentAt ? lastPaymentAt.toISOString() : null,
        }
      : null,
    credits:
      studentPayments.length > 0
        ? {
            available: creditsAvailable,
            total: studentPayments.length,
            payments: studentPayments
              .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
              .map((p) => ({
                id: p.id,
                paidAt: p.paidAt.toISOString(),
                amountCents: p.amountCents,
                redeemed: p.redeemedAt !== null,
              })),
          }
        : null,
    checkinsToday: studentCheckinsToday
      .sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime())
      .map((c) => ({
        id: c.id,
        checkedInAt: c.checkedInAt.toISOString(),
        checkedInBy: c.checkedInBy,
        paymentId: c.paymentId,
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
    allCheckinRows,
    studentEmailRows,
  ] = await Promise.all([
    db.select().from(waivers).where(inArray(waivers.studentId, ids)),
    db.select().from(memberships).where(inArray(memberships.studentId, ids)),
    db.select().from(membershipCharges).where(inArray(membershipCharges.studentId, ids)),
    db.select().from(payments).where(inArray(payments.studentId, ids)),
    // Not date-filtered: buildStatus needs both the viewed day's check-ins and
    // whether the student has ANY real check-in ever (for the New Student promo).
    db
      .select()
      .from(checkins)
      .where(and(inArray(checkins.studentId, ids), isNull(checkins.undoneAt))),
    db.select().from(studentEmails).where(inArray(studentEmails.studentId, ids)),
  ]);

  const statuses = studentRows.map((s) =>
    buildStatus(
      s,
      waiverRows,
      membershipRows,
      membershipChargeRows,
      paymentRows,
      allCheckinRows,
      studentEmailRows,
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
