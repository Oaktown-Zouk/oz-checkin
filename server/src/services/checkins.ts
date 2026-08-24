import {
  createRecords,
  updateRecord,
  listRecords,
  getRecordOrNull,
  TABLES,
  type AirtableRecord,
} from "../airtable/client.js";
import type { CheckinFields, CreditFields, MemberFields } from "../airtable/fields.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { dateStringFor, STUDIO_TIMEZONE } from "../lib/date.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

export interface CheckInSelection {
  programId: string;
  role: "Lead" | "Follow";
}

async function checkinsForDate(dateStr: string, fields: string[]): Promise<AirtableRecord<CheckinFields>[]> {
  return listRecords<CheckinFields>(TABLES.checkins, {
    filterByFormula: `AND(DATETIME_FORMAT(SET_TIMEZONE({Checked In At}, '${STUDIO_TIMEZONE}'), 'YYYY-MM-DD') = '${dateStr}', {Undone At} = BLANK())`,
    fields,
  });
}

async function consumeOldestCreditOrFlag(studentId: string, checkinId: string): Promise<void> {
  const credits = await listRecords<CreditFields>(TABLES.credits, {
    filterByFormula: "{Available} = 1",
    fields: ["Member", "Granted At"],
    sort: [{ field: "Granted At", direction: "asc" }],
  });
  const candidate = credits.find((c) => (c.fields.Member ?? []).includes(studentId));

  if (candidate) {
    await updateRecord<CreditFields>(TABLES.credits, candidate.id, {
      "Consumed At": new Date().toISOString(),
      "Consumed By Check-in": [checkinId],
    });
  } else {
    await updateRecord<CheckinFields>(TABLES.checkins, checkinId, {
      "Needs Review": true,
      "Review Reason": "Beyond tier allowance, no credit available",
    });
  }
}

// Backdated path only — Automation C's same-day guard means it no-ops for these, so
// the app mirrors its gating logic itself, parameterized by the backdated date instead
// of literal "today." See docs/airtable-schema.md, "Credits" (backdated gating).
async function gateBackdatedCheckIns(
  studentId: string,
  effectiveAt: Date,
  createdCheckins: AirtableRecord<CheckinFields>[]
): Promise<void> {
  const dateStr = dateStringFor(effectiveAt);
  const createdIds = new Set(createdCheckins.map((c) => c.id));

  const existing = await checkinsForDate(dateStr, ["Member"]);
  const priorCount = existing.filter(
    (c) => (c.fields.Member ?? []).includes(studentId) && !createdIds.has(c.id)
  ).length;

  const member = await getRecordOrNull<MemberFields>(TABLES.members, studentId);
  const classesAllowed = member?.fields["Classes Allowed"] ?? 0;

  // createRecords (batch create) preserves request order, so index+1 is this row's
  // position among today's check-ins for this student — same semantics as Automation
  // C's nthToday.
  for (let i = 0; i < createdCheckins.length; i++) {
    const nth = priorCount + i + 1;
    if (nth > classesAllowed) {
      await consumeOldestCreditOrFlag(studentId, createdCheckins[i].id);
    }
  }
}

export async function createCheckIns(
  studentId: string,
  selections: CheckInSelection[],
  opts: { effectiveAt?: Date } = {}
): Promise<StudentStatus> {
  if (selections.length === 0) {
    throw new ConflictError("At least one program/role selection is required.");
  }

  const isLive = !opts.effectiveAt;
  const checkedInAt = opts.effectiveAt ?? new Date();

  const created = await createRecords<CheckinFields>(
    TABLES.checkins,
    selections.map((s) => ({
      Member: [studentId],
      "Checked In At": checkedInAt.toISOString(),
      "Class Level": [s.programId],
      Role: s.role,
    }))
  );

  if (!isLive) {
    await gateBackdatedCheckIns(studentId, checkedInAt, created);
  }
  // Live path: Automation C (same-day guarded) handles gating/credit-consumption on
  // its own once these records land — nothing more to do here.

  const updated = await getStudentStatusById(studentId, isLive ? undefined : dateStringFor(checkedInAt));
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}

export async function undoCheckIn(checkinId: string): Promise<StudentStatus> {
  const checkin = await getRecordOrNull<CheckinFields>(TABLES.checkins, checkinId);
  if (!checkin) throw new NotFoundError("Check-in not found");
  if (checkin.fields["Undone At"]) throw new ConflictError("Already undone");

  const memberId = checkin.fields.Member?.[0];
  if (!memberId) throw new NotFoundError("Student not found");

  await updateRecord<CheckinFields>(TABLES.checkins, checkinId, {
    "Undone At": new Date().toISOString(),
  });
  // Automation D frees any credit this check-in consumed, and the live rollup
  // (Checked In Today (Live) -> Remaining Today) self-corrects — nothing else to do.

  const viewedDate = checkin.fields["Checked In At"]
    ? dateStringFor(new Date(checkin.fields["Checked In At"]))
    : undefined;
  const updated = await getStudentStatusById(memberId, viewedDate);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
