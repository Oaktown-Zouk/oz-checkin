import { listRecords, TABLES } from "../airtable/client.js";
import type {
  RecurringPlanFields,
  TransactionFields,
  CreditFields,
  CheckinFields,
  LevelupFields,
  NoteFields,
} from "../airtable/fields.js";
import { fetchProgramNames, getStudentStatusById, type StudentStatus } from "./studentStatus.js";

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

export async function getStudentTimeline(studentId: string): Promise<StudentTimeline | null> {
  const status = await getStudentStatusById(studentId);
  if (!status) return null;

  const [plans, transactions, credits, checkins, levelups, notes, programNameById] = await Promise.all([
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
      fields: ["Member", "Checked In At", "Class Level", "Role"],
    }),
    listRecords<LevelupFields>(TABLES.levelups, {
      fields: ["Member", "Role", "From", "To", "Issuer Name"],
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
  const myLevelups = levelups.filter((l) => l.fields.Member?.includes(studentId));
  const myNotes = notes.filter((n) => n.fields.Member?.includes(studentId));

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

  // A student's first-ever level in a role (no "From") isn't a level-*up* — nothing
  // to have leveled up from — so it's left out of the timeline entirely.
  for (const l of myLevelups) {
    const { From: from, To: to, Role: role } = l.fields;
    if (from === undefined) continue;
    const isIncrease = to !== undefined && to > from;
    const base =
      to === undefined
        ? `Level cleared as a ${role}`
        : isIncrease
          ? `Assessed into Level ${to} as a ${role}`
          : `Changed to Level ${to} as a ${role}`;
    const issuerName = l.fields["Issuer Name"]?.[0];
    events.push({
      type: "levelup",
      at: l.createdTime,
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
