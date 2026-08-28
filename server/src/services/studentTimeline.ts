import { listRecords, getRecordOrNull, TABLES } from "../airtable/client.js";
import type {
  RecurringPlanFields,
  TransactionFields,
  CreditFields,
  CheckinFields,
  NoteFields,
  MemberFields,
} from "../airtable/fields.js";
import { fetchProgramNames, buildStatus, computeLastCheckinSelections, type StudentStatus } from "./studentStatus.js";
import { today, dateStringFor } from "../lib/date.js";

export interface NoteDetails {
  summary: string;
  strengths: string;
  opportunities: string;
  issuerName: string;
}

export interface TimelineEvent {
  type: "membership_started" | "membership_status" | "payment" | "credit_granted" | "checkin" | "levelup" | "note";
  at: string;
  label: string;
  // Populated only for type "note" — the full text behind the on-timeline summary,
  // shown in a detail modal when that row is clicked (see StudentPage.tsx).
  note?: NoteDetails;
}

export interface StudentTimeline {
  status: StudentStatus;
  totalCheckIns: number;
  mostRecentCheckInAt: string | null;
  events: TimelineEvent[];
}

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Always a live ("today") view — no caller ever passes a date (see routes/students.ts,
// studentApp.ts) — so this fetches everything itself in one batch rather than going
// through getStudentStatusById, which would redundantly re-fetch Programs and re-scan
// Check-ins for its own, narrower purposes. This function already needs this student's
// *entire* non-undone check-in history for the timeline's own check-in events, so
// today's check-ins (for status.checkinsToday/remaining) and the most-recent-visit
// preselection (for status.lastCheckinSelections) are both just derived from that same
// already-fetched list in memory — no separate fetch for either.
export async function getStudentTimeline(studentId: string): Promise<StudentTimeline | null> {
  const member = await getRecordOrNull<MemberFields>(TABLES.members, studentId);
  if (!member) return null;

  const [plans, transactions, credits, checkins, notes, programNameById] = await Promise.all([
    listRecords<RecurringPlanFields>(TABLES.recurringPlans, {
      fields: ["Covers Member", "Status", "Start Date", "Frequency", "Canceled At"],
    }),
    listRecords<TransactionFields>(TABLES.transactions, {
      fields: ["Member", "Amount", "Transacted At", "Is Recurring", "Plan ID", "Refunded"],
    }),
    listRecords<CreditFields>(TABLES.credits, {
      fields: ["Member", "Reason", "Granted At"],
    }),
    listRecords<CheckinFields>(TABLES.checkins, {
      filterByFormula: "{Undone At} = BLANK()",
      fields: ["Member", "Checked In At", "Class Level", "Role", "Needs Review", "Review Reason"],
    }),
    listRecords<NoteFields>(TABLES.notes, {
      fields: ["Member", "Summary", "Strengths", "Opportunities", "Issuer Name"],
    }),
    fetchProgramNames(),
  ]);

  const myPlans = plans.filter((p) => p.fields["Covers Member"]?.includes(studentId));
  const myTransactions = transactions.filter((t) => t.fields.Member?.includes(studentId) && !t.fields.Refunded);
  const myCredits = credits.filter((c) => c.fields.Member?.includes(studentId));
  const myCheckins = checkins.filter((c) => c.fields.Member?.includes(studentId));
  const myNotes = notes.filter((n) => n.fields.Member?.includes(studentId));

  const todayStr = today();
  const myCheckinsToday = myCheckins.filter(
    (c) => c.fields["Checked In At"] && dateStringFor(new Date(c.fields["Checked In At"])) === todayStr
  );
  const status = buildStatus(member, true, myCheckinsToday, programNameById, computeLastCheckinSelections(myCheckins));

  const events: TimelineEvent[] = [];

  for (const p of myPlans) {
    const startedAt = p.fields["Start Date"] ?? p.createdTime;
    events.push({
      type: "membership_started",
      at: startedAt,
      label: `Membership started${p.fields.Frequency ? ` (${p.fields.Frequency})` : ""}`,
    });
    if (p.fields.Status && p.fields.Status.toLowerCase() !== "active") {
      events.push({
        type: "membership_status",
        at: p.fields["Canceled At"] ?? startedAt,
        label: `Membership ${p.fields.Status}`,
      });
    }
  }

  for (const t of myTransactions) {
    const isMembershipCharge = t.fields["Is Recurring"] || Boolean(t.fields["Plan ID"]);
    events.push({
      type: "payment",
      at: t.fields["Transacted At"] ?? "",
      label: isMembershipCharge
        ? `Membership payment (${formatDollars(t.fields.Amount ?? 0)})`
        : `One-time pass purchased (${formatDollars(t.fields.Amount ?? 0)})`,
    });
  }

  for (const c of myCredits) {
    events.push({
      type: "credit_granted",
      at: c.fields["Granted At"] ?? "",
      label: c.fields.Reason === "New Member" ? "Free drop-in credit granted" : `Credit granted (${c.fields.Reason ?? "unknown"})`,
    });
  }

  for (const c of myCheckins) {
    const programName = c.fields["Class Level"]?.[0] ? programNameById.get(c.fields["Class Level"][0]) : undefined;
    const detail = [programName, c.fields.Role].filter(Boolean).join(", ");
    events.push({
      type: "checkin",
      at: c.fields["Checked In At"] ?? "",
      label: detail ? `Checked in (${detail})` : "Checked in",
    });
  }

  // Straight off the member record's own Lookup fields (through the Levelups link) —
  // no separate Levelups table read at all. The four arrays are guaranteed the same
  // length (see MemberFields's comment on these fields for why plain From/To lookups
  // wouldn't be safe to zip this way), so index i across all of them is one levelup
  // record. A student's first-ever level in a role (no "From") isn't a level-*up* —
  // nothing to have leveled up from — so it's left out of the timeline entirely.
  const levelupRoles = member.fields["Role (from Levelups)"] ?? [];
  const levelupFroms = member.fields["From (safe, from Levelups)"] ?? [];
  const levelupTos = member.fields["To (safe, from Levelups)"] ?? [];
  const levelupIssuerNames = member.fields["Issuer Name (from Levelups)"] ?? [];
  const levelupCreatedAts = member.fields["Created (from Levelups)"] ?? [];
  for (let i = 0; i < levelupRoles.length; i++) {
    const role = levelupRoles[i];
    const from = levelupFroms[i] === -1 ? undefined : levelupFroms[i];
    const to = levelupTos[i] === -1 ? undefined : levelupTos[i];
    if (from === undefined) continue;
    const isIncrease = to !== undefined && to > from;
    const base =
      to === undefined
        ? `Level cleared as a ${role}`
        : isIncrease
          ? `Assessed into Level ${to} as a ${role}`
          : `Changed to Level ${to} as a ${role}`;
    const issuerName = levelupIssuerNames[i];
    events.push({
      type: "levelup",
      at: levelupCreatedAts[i] ?? "",
      label: issuerName ? `${base} by ${issuerName}` : base,
    });
  }

  for (const n of myNotes) {
    const summary = n.fields.Summary ?? "";
    const issuerName = n.fields["Issuer Name"]?.[0] ?? "Unknown";
    events.push({
      type: "note",
      at: n.createdTime,
      label: `Note from ${issuerName}: ${summary}`,
      note: {
        summary,
        strengths: n.fields.Strengths ?? "",
        opportunities: n.fields.Opportunities ?? "",
        issuerName,
      },
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  const mostRecentCheckInAt = myCheckins.reduce<string | null>((latest, c) => {
    const at = c.fields["Checked In At"];
    if (!at) return latest;
    return !latest || at > latest ? at : latest;
  }, null);

  return {
    status,
    totalCheckIns: myCheckins.length,
    mostRecentCheckInAt,
    events,
  };
}
