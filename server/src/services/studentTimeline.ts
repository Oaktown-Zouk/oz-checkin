import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { checkins, memberships, payments, students, waivers } from "../db/schema.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

export interface TimelineEvent {
  type: "membership_started" | "membership_status" | "payment" | "checkin";
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

  const [waiverRows, membershipRows, paymentRows, checkinRows, status] = await Promise.all([
    db.select().from(waivers).where(eq(waivers.studentId, studentId)),
    db.select().from(memberships).where(eq(memberships.studentId, studentId)),
    db.select().from(payments).where(eq(payments.studentId, studentId)),
    // Undone check-ins are corrections, not real visits — excluded from history same as
    // everCheckedIn treats them.
    db
      .select()
      .from(checkins)
      .where(and(eq(checkins.studentId, studentId), isNull(checkins.undoneAt))),
    getStudentStatusById(studentId),
  ]);

  if (!status) return null;

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
    events.push({
      type: "payment",
      at: p.paidAt.toISOString(),
      label: `One-time pass purchased (${formatDollars(p.amountCents)})`,
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

  const firstRegisteredCandidates: Date[] = [
    ...waiverRows.map((w) => w.signedAt),
    ...paymentRows.map((p) => p.paidAt),
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
