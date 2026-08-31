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
      "Consumed By Check-in": [checkinId],
    });
  } else {
    await updateRecord<CheckinFields>(TABLES.checkins, checkinId, {
      "Needs Review": true,
      "Review Reason": "Beyond tier allowance, no credit available",
    });
  }
}

// Runs for every check-in creation, live or backdated — the app computes gating and
// consumes/flags credits itself rather than relying on an Airtable automation, which
// proved unreliable and slow in practice. Since this app's own testing and manual QA
// lean heavily on the backdated path, an automation reacting only to live check-ins
// wasn't getting regularly exercised either, letting failures go unnoticed.
async function gateCheckIns(
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
  // position among this date's check-ins for this student.
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
  opts: { effectiveAt?: Date; method?: CheckinFields["Method"] } = {}
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
      ...(opts.method ? { Method: opts.method } : {}),
    }))
  );

  await gateCheckIns(studentId, checkedInAt, created);

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

  // Free any credit this check-in had consumed, immediately — mirrors gateCheckIns's
  // move off of an Airtable automation for the same reason: no waiting on a separate
  // async trigger. checkin.fields.Credits is the check-in's own reverse link to
  // whichever Credits record consumed it (set by consumeOldestCreditOrFlag), already
  // in hand from the getRecordOrNull above — no extra read needed to find it.
  const consumedCreditId = checkin.fields.Credits?.[0];
  if (consumedCreditId) {
    await updateRecord<CreditFields>(TABLES.credits, consumedCreditId, {
      "Consumed By Check-in": [],
    });
  }
  // The live rollup (Checked In Today (Live) -> Remaining Today) self-corrects on its
  // own once Undone At is set — nothing else to do for that part.

  const viewedDate = checkin.fields["Checked In At"]
    ? dateStringFor(new Date(checkin.fields["Checked In At"]))
    : undefined;
  const updated = await getStudentStatusById(memberId, viewedDate);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}
