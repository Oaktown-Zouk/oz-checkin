import { listRecords, getRecordOrNull, updateRecord, TABLES } from "../airtable/client.js";
import type { MemberFields, RecurringPlanFields } from "../airtable/fields.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { normalizeEmail } from "../lib/date.js";
import { getStudentStatusById, type StudentStatus } from "./studentStatus.js";

async function findMemberIdByEmail(rawEmail: string): Promise<string | undefined> {
  const email = normalizeEmail(rawEmail).replace(/'/g, "\\'");
  const matches = await listRecords<MemberFields>(TABLES.members, {
    filterByFormula: `LOWER({Email}) = '${email}'`,
    fields: ["Email"],
  });
  return matches[0]?.id;
}

// Membership-only for now, per product decision — Recurring Plans already splits
// Member (payer, untouched) vs Covers Member (holder), so this is just a record update.
export async function transferMembership(
  sourceStudentId: string,
  planId: string,
  targetEmailRaw: string
): Promise<StudentStatus> {
  const targetId = await findMemberIdByEmail(targetEmailRaw);
  if (!targetId) throw new NotFoundError(`No student found with email ${targetEmailRaw}`);
  if (targetId === sourceStudentId) {
    throw new ConflictError("That email already belongs to this student.");
  }

  const plan = await getRecordOrNull<RecurringPlanFields>(TABLES.recurringPlans, planId);
  if (!plan) throw new NotFoundError("Membership not found");

  const currentHolderId = plan.fields["Covers Member"]?.[0] ?? plan.fields.Member?.[0];
  if (currentHolderId !== sourceStudentId) {
    throw new ConflictError("That membership doesn't belong to this student. Refresh and try again.");
  }

  await updateRecord<RecurringPlanFields>(TABLES.recurringPlans, planId, {
    "Covers Member": [targetId],
  });

  const updated = await getStudentStatusById(sourceStudentId);
  if (!updated) throw new NotFoundError("Student not found");
  return updated;
}

export interface HeldMembership {
  id: string;
  status: string;
  frequency: string | null;
  amount: number | null;
}

export async function heldMemberships(studentId: string): Promise<HeldMembership[]> {
  const plans = await listRecords<RecurringPlanFields>(TABLES.recurringPlans, {
    fields: ["Covers Member", "Status", "Frequency", "Amount"],
  });
  return plans
    .filter((p) => p.fields["Covers Member"]?.includes(studentId))
    .map((p) => ({
      id: p.id,
      status: p.fields.Status ?? "unknown",
      frequency: p.fields.Frequency ?? null,
      amount: p.fields.Amount ?? null,
    }));
}
