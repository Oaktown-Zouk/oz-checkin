import { listRecords, getRecordOrNull, updateRecord, TABLES, type AirtableRecord } from "../airtable/client.js";
import type { MemberFields, CheckinFields, ProgramFields } from "../airtable/fields.js";
import { today, dateStringFor, STUDIO_TIMEZONE } from "../lib/date.js";
import { NotFoundError } from "../lib/errors.js";

export interface CheckInInfo {
  id: string;
  checkedInAt: string;
  programName: string | null;
  role: "Lead" | "Follow" | null;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface RecentCheckinSelection {
  programId: string;
  role: "Lead" | "Follow";
}

export interface StudentStatus {
  id: string;
  name: string;
  email: string;
  leadLevel: number | null;
  followLevel: number | null;
  accessStatus: string;
  membershipStatus: string;
  tierName: string | null;
  classesAllowed: number;
  // "Remaining" for the viewed date. For live/today, read straight from Airtable's
  // Remaining Today (Automation C already keeps it correct). For a backdated view,
  // Airtable's live fields can't represent a past date, so the app computes it itself —
  // see docs/airtable-schema.md, "Credits" (backdated gating).
  remaining: number;
  // Current truth, never reconstructed historically — matches the old app's behavior.
  availableCredits: number;
  checkinsToday: CheckInInfo[];
  checkedInToday: boolean;
  // Drives roster sort order (see listStudentStatuses) — the 30-day threshold lives in
  // the Airtable formula, not here.
  recentlyActive: boolean;
  // The programs/roles from this student's most recent check-in occasion, computed once
  // per roster fetch (see fetchMostRecentCheckinsByMember) rather than per dialog-open.
  // Not backdating-aware on purpose — always the true most recent visit regardless of
  // viewed date, per product decision (an Airtable-formula version of this hit a real
  // platform limit: rollups of dateTime values via MAX() always collapse to date-only
  // precision, and grouping by date-only risks a UTC-vs-studio-timezone mismatch this
  // app is otherwise careful about — see lib/date.ts. Doing it here reuses that already-
  // correct timezone handling instead).
  lastCheckinSelections: RecentCheckinSelection[];
}

export async function fetchProgramNames(): Promise<Map<string, string>> {
  const programs = await listRecords<ProgramFields>(TABLES.programs, { fields: ["Program Name"] });
  return new Map(programs.map((p) => [p.id, p.fields["Program Name"] ?? "Unknown"]));
}

async function fetchCheckinsForDate(viewedDate: string): Promise<AirtableRecord<CheckinFields>[]> {
  return listRecords<CheckinFields>(TABLES.checkins, {
    filterByFormula: `AND(DATETIME_FORMAT(SET_TIMEZONE({Checked In At}, '${STUDIO_TIMEZONE}'), 'YYYY-MM-DD') = '${viewedDate}', {Undone At} = BLANK())`,
    fields: ["Member", "Checked In At", "Class Level", "Role", "Needs Review", "Review Reason"],
  });
}

// No Member filter is possible via Airtable's formula language for a linked field (it
// only exposes the linked record's primary-field text, not its id), so this scans the
// whole non-undone Check-ins table once and groups in memory — same tradeoff already
// made in studentTimeline.ts, just shared across the whole roster instead of per-student.
async function fetchMostRecentCheckinsByMember(): Promise<Map<string, RecentCheckinSelection[]>> {
  const all = await listRecords<CheckinFields>(TABLES.checkins, {
    filterByFormula: "{Undone At} = BLANK()",
    fields: ["Member", "Checked In At", "Class Level", "Role"],
  });

  const byMember = new Map<string, AirtableRecord<CheckinFields>[]>();
  for (const c of all) {
    const memberId = c.fields.Member?.[0];
    if (!memberId || !c.fields["Checked In At"]) continue;
    const list = byMember.get(memberId) ?? [];
    list.push(c);
    byMember.set(memberId, list);
  }

  const result = new Map<string, RecentCheckinSelection[]>();
  for (const [memberId, memberCheckins] of byMember) {
    let mostRecentDate: string | null = null;
    for (const c of memberCheckins) {
      const d = dateStringFor(new Date(c.fields["Checked In At"]!));
      if (!mostRecentDate || d > mostRecentDate) mostRecentDate = d;
    }
    const selections = memberCheckins
      .filter((c) => dateStringFor(new Date(c.fields["Checked In At"]!)) === mostRecentDate)
      .filter((c) => c.fields["Class Level"]?.[0] && c.fields.Role)
      .map((c) => ({ programId: c.fields["Class Level"]![0], role: c.fields.Role! }));
    result.set(memberId, selections);
  }
  return result;
}

function buildStatus(
  member: AirtableRecord<MemberFields>,
  isLiveToday: boolean,
  checkinsForMember: AirtableRecord<CheckinFields>[],
  programNameById: Map<string, string>,
  lastCheckinSelections: RecentCheckinSelection[]
): StudentStatus {
  const f = member.fields;
  const classesAllowed = f["Classes Allowed"] ?? 0;
  const remaining = isLiveToday ? (f["Remaining Today"] ?? classesAllowed) : classesAllowed - checkinsForMember.length;

  return {
    id: member.id,
    name: f["Full Name"] ?? "Unnamed member",
    email: f.Email ?? "",
    leadLevel: f["Lead Level"] ?? null,
    followLevel: f["Follow Level"] ?? null,
    accessStatus: f["Access Status"] ?? "Inactive",
    membershipStatus: f["Membership Status"] ?? "Prospect",
    tierName: f["Tier Name"] ?? null,
    classesAllowed,
    remaining,
    availableCredits: f["Available Credits"] ?? 0,
    checkinsToday: checkinsForMember
      .slice()
      .sort((a, b) => (a.fields["Checked In At"] ?? "").localeCompare(b.fields["Checked In At"] ?? ""))
      .map((c) => ({
        id: c.id,
        checkedInAt: c.fields["Checked In At"] ?? "",
        programName: c.fields["Class Level"]?.[0]
          ? (programNameById.get(c.fields["Class Level"][0]) ?? null)
          : null,
        role: c.fields.Role ?? null,
        needsReview: c.fields["Needs Review"] ?? false,
        reviewReason: c.fields["Review Reason"] ?? null,
      })),
    checkedInToday: checkinsForMember.length > 0,
    recentlyActive: !!f["Recently Active"],
    lastCheckinSelections,
  };
}

export async function listStudentStatuses(opts: { date?: string } = {}): Promise<StudentStatus[]> {
  const viewedDate = opts.date ?? today();
  const isLiveToday = viewedDate === today();

  const [members, checkins, programNameById, mostRecentByMember] = await Promise.all([
    listRecords<MemberFields>(TABLES.members, {
      // Excludes records flagged as a stray Givebutter sync duplicate (see
      // airtable/fields.ts) — filtered server-side so the roster never even fetches
      // them, not just hides them client-side.
      filterByFormula: "NOT({Duplicate})",
      fields: [
        "Full Name",
        "Email",
        "Lead Level",
        "Follow Level",
        "Access Status",
        "Membership Status",
        "Tier Name",
        "Classes Allowed",
        "Remaining Today",
        "Available Credits",
        "Recently Active",
      ],
    }),
    fetchCheckinsForDate(viewedDate),
    fetchProgramNames(),
    fetchMostRecentCheckinsByMember(),
  ]);

  const checkinsByMember = new Map<string, AirtableRecord<CheckinFields>[]>();
  for (const c of checkins) {
    const memberId = c.fields.Member?.[0];
    if (!memberId) continue;
    const list = checkinsByMember.get(memberId) ?? [];
    list.push(c);
    checkinsByMember.set(memberId, list);
  }

  const statuses = members.map((m) =>
    buildStatus(
      m,
      isLiveToday,
      checkinsByMember.get(m.id) ?? [],
      programNameById,
      mostRecentByMember.get(m.id) ?? []
    )
  );

  // Three sort groups: recently active < stale (30+ days, or never active) < checked in today.
  const displayOrder = (s: StudentStatus) => (s.checkedInToday ? 2 : s.recentlyActive ? 0 : 1);

  statuses.sort((a, b) => {
    const orderDiff = displayOrder(a) - displayOrder(b);
    if (orderDiff !== 0) return orderDiff;
    if (a.checkedInToday && b.checkedInToday) {
      return (a.checkinsToday[0]?.checkedInAt ?? "").localeCompare(b.checkinsToday[0]?.checkedInAt ?? "");
    }
    return a.name.localeCompare(b.name);
  });

  return statuses;
}

export async function getStudentStatusById(id: string, date?: string): Promise<StudentStatus | null> {
  const viewedDate = date ?? today();
  const isLiveToday = viewedDate === today();

  const member = await getRecordOrNull<MemberFields>(TABLES.members, id);
  if (!member) return null;

  const [checkinsForDate, programNameById, mostRecentByMember] = await Promise.all([
    fetchCheckinsForDate(viewedDate),
    fetchProgramNames(),
    fetchMostRecentCheckinsByMember(),
  ]);
  const mine = checkinsForDate.filter((c) => c.fields.Member?.includes(id));

  return buildStatus(member, isLiveToday, mine, programNameById, mostRecentByMember.get(id) ?? []);
}

export async function updateStudentLevel(
  id: string,
  field: "Lead Level" | "Follow Level",
  level: number | null
): Promise<StudentStatus> {
  if (!(await getRecordOrNull<MemberFields>(TABLES.members, id))) {
    throw new NotFoundError("Student not found");
  }
  await updateRecord<Record<"Lead Level" | "Follow Level", number | null>>(TABLES.members, id, {
    [field]: level,
  } as Record<"Lead Level" | "Follow Level", number | null>);

  const updated = await getStudentStatusById(id);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
