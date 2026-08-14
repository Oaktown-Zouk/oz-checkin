import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  checkins,
  memberships,
  membershipCharges,
  payments,
  promoCredits,
  students,
  waivers,
} from "../db/schema.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

export interface TimelineEvent {
  type:
    | "membership_started"
    | "membership_status"
    | "membership_payment"
    | "membership_payment_for_other"
    | "payment"
    | "promo_credit"
    | "checkin";
  at: string;
  label: string;
}

export interface StudentTimeline {
  status: StudentStatus;
  // Earliest touchpoint from either source — a waiver signature, a payment, or a
  // membership starting — not just whichever the student happened to submit first.
  firstRegisteredAt: string | null;
  mostRecentCheckInAt: string | null;
  totalCheckIns: number;
  // Newest first, like an activity feed.
  events: TimelineEvent[];
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function getStudentTimeline(studentId: number): Promise<StudentTimeline | null> {
  const [student] = await db.select().from(students).where(eq(students.id, studentId));
  if (!student) return null;

  const [
    waiverRows,
    membershipRows,
    allMembershipChargeRows,
    paymentRows,
    promoCreditRows,
    checkinRows,
    status,
  ] = await Promise.all([
    db.select().from(waivers).where(eq(waivers.studentId, studentId)),
    // holderStudentId, not studentId — who this membership belongs to for app purposes
    // (see services/studentStatus.ts / services/transfers.ts).
    db.select().from(memberships).where(eq(memberships.holderStudentId, studentId)),
    // Both directions: charges I hold (mine) and charges I paid for that are now held by
    // someone else (surfaced as membership_payment_for_other events below).
    db
      .select()
      .from(membershipCharges)
      .where(or(eq(membershipCharges.holderStudentId, studentId), eq(membershipCharges.studentId, studentId))),
    db.select().from(payments).where(eq(payments.holderStudentId, studentId)),
    db.select().from(promoCredits).where(eq(promoCredits.studentId, studentId)),
    // Undone check-ins are corrections, not real visits — excluded from history same as
    // everCheckedIn treats them.
    db
      .select()
      .from(checkins)
      .where(and(eq(checkins.studentId, studentId), isNull(checkins.undoneAt))),
    getStudentStatusById(studentId),
  ]);

  if (!status) return null;

  const membershipChargeRows = allMembershipChargeRows.filter((c) => c.holderStudentId === studentId);
  const paidForOtherChargeRows = allMembershipChargeRows.filter(
    (c) => c.studentId === studentId && c.holderStudentId !== studentId
  );

  // Names for anyone this student's records reference but isn't the student themself —
  // the other holder on a paid-for-other charge, or the original payer on a
  // transferred-in membership charge/payment (see services/transfers.ts).
  const otherIds = new Set<number>();
  for (const c of paidForOtherChargeRows) otherIds.add(c.holderStudentId!);
  for (const c of membershipChargeRows) if (c.studentId !== studentId) otherIds.add(c.studentId);
  for (const p of paymentRows) if (p.studentId !== studentId) otherIds.add(p.studentId);
  const otherNameById = new Map<number, string>();
  if (otherIds.size > 0) {
    const otherStudents = await db
      .select({ id: students.id, name: students.name })
      .from(students)
      .where(inArray(students.id, [...otherIds]));
    for (const s of otherStudents) otherNameById.set(s.id, s.name);
  }

  const events: TimelineEvent[] = [];

  for (const m of membershipRows) {
    const startedAt = m.startedAt ?? m.createdAt;
    events.push({
      type: "membership_started",
      at: startedAt.toISOString(),
      label: `Membership started${m.frequency ? ` (${m.frequency})` : ""}`,
    });

    if (m.status.toLowerCase() !== "active") {
      const at = m.canceledAt ?? m.updatedAt;
      events.push({
        type: "membership_status",
        at: at.toISOString(),
        // Uses Givebutter's actual status word rather than assuming "paused" vs
        // "cancelled" — we don't have full certainty on every value it can take.
        label: `Membership ${m.status}`,
      });
    }
  }

  for (const p of paymentRows) {
    const purchasedByName = p.studentId !== studentId ? otherNameById.get(p.studentId) : undefined;
    events.push({
      type: "payment",
      at: p.paidAt.toISOString(),
      label: purchasedByName
        ? `One-time pass received from ${purchasedByName} (${formatDollars(p.amountCents)})`
        : `One-time pass purchased (${formatDollars(p.amountCents)})`,
    });
  }

  for (const c of membershipChargeRows) {
    const paidByName = c.studentId !== studentId ? otherNameById.get(c.studentId) : undefined;
    events.push({
      type: "membership_payment",
      at: c.paidAt.toISOString(),
      label: paidByName
        ? `Membership payment, paid by ${paidByName} (${formatDollars(c.amountCents)})`
        : `Membership payment (${formatDollars(c.amountCents)})`,
    });
  }

  for (const c of paidForOtherChargeRows) {
    const holderName = otherNameById.get(c.holderStudentId!) ?? "another student";
    events.push({
      type: "membership_payment_for_other",
      at: c.paidAt.toISOString(),
      label: `Paid for ${holderName}'s membership (${formatDollars(c.amountCents)})`,
    });
  }

  for (const c of promoCreditRows) {
    events.push({
      type: "promo_credit",
      at: c.grantedAt.toISOString(),
      label: c.reason === "new_student" ? "Free drop-in credit granted" : `Promo credit granted (${c.reason})`,
    });
  }

  for (const c of checkinRows) {
    events.push({
      type: "checkin",
      at: c.checkedInAt.toISOString(),
      label: "Checked in",
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  // promoCredits.grantedAt is deliberately excluded here — it's a sync-time stamp (when
  // we first saw this student), not a real-world event time like a waiver signature or
  // a payment, so it shouldn't be able to set firstRegisteredAt (same reasoning as
  // membership's startedAt/canceledAt vs. our own createdAt — see schema.ts).
  const firstRegisteredCandidates: Date[] = [
    ...waiverRows.map((w) => w.signedAt),
    ...paymentRows.map((p) => p.paidAt),
    ...membershipChargeRows.map((c) => c.paidAt),
    ...membershipRows.map((m) => m.startedAt ?? m.createdAt),
  ];
  const firstRegisteredAt = firstRegisteredCandidates.length
    ? new Date(Math.min(...firstRegisteredCandidates.map((d) => d.getTime()))).toISOString()
    : null;

  const mostRecentCheckInAt = checkinRows.length
    ? new Date(Math.max(...checkinRows.map((c) => c.checkedInAt.getTime()))).toISOString()
    : null;

  return {
    status,
    firstRegisteredAt,
    mostRecentCheckInAt,
    totalCheckIns: checkinRows.length,
    events,
  };
}
