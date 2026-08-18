import { listRecords, getRecordOrNull, updateRecord, TABLES, type AirtableRecord } from "../airtable/client.js";
import type { MemberFields, CheckinFields, ProgramFields } from "../airtable/fields.js";
import { today, STUDIO_TIMEZONE } from "../lib/date.js";
import { NotFoundError } from "../lib/errors.js";

export interface CheckInInfo {
  id: string;
  checkedInAt: string;
  programName: string | null;
  role: "Lead" | "Follow" | null;
  needsReview: boolean;
  reviewReason: string | null;
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
  // see docs/airtable-schema.md "Backdating".
  remaining: number;
  // Current truth, never reconstructed historically — matches the old app's behavior.
  availableCredits: number;
  checkinsToday: CheckInInfo[];
  checkedInToday: boolean;
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

function buildStatus(
  member: AirtableRecord<MemberFields>,
  isLiveToday: boolean,
  checkinsForMember: AirtableRecord<CheckinFields>[],
  programNameById: Map<string, string>
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
  };
}

export async function listStudentStatuses(opts: { date?: string } = {}): Promise<StudentStatus[]> {
  const viewedDate = opts.date ?? today();
  const isLiveToday = viewedDate === today();

  const [members, checkins, programNameById] = await Promise.all([
    listRecords<MemberFields>(TABLES.members, {
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
      ],
    }),
    fetchCheckinsForDate(viewedDate),
    fetchProgramNames(),
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
    buildStatus(m, isLiveToday, checkinsByMember.get(m.id) ?? [], programNameById)
  );

  statuses.sort((a, b) => {
    if (a.checkedInToday !== b.checkedInToday) return a.checkedInToday ? 1 : -1;
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

  const [checkinsForDate, programNameById] = await Promise.all([
    fetchCheckinsForDate(viewedDate),
    fetchProgramNames(),
  ]);
  const mine = checkinsForDate.filter((c) => c.fields.Member?.includes(id));

  return buildStatus(member, isLiveToday, mine, programNameById);
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
