import { listRecords, getRecordOrNull, TABLES } from "../airtable/client.js";
import type { UserRoleFields, RolePermissionFields, MemberFields, UserRole, Permission } from "../airtable/fields.js";

const ALL_PERMISSIONS: Permission[] = [
  "View Student Data",
  "Write Student Data",
  "Create Checkins",
  "Undo Checkins",
  "Write Memberships",
  "Backdate Kiosk",
];

export interface UserAccess {
  role: UserRole;
  permissions: Permission[];
  // The signed-in User Roles row's own record id — baked into the session cookie
  // (see lib/session.ts) so anything needing "who did this" (e.g. Levelups.Issuer)
  // has it for free at write time, with no extra Airtable lookup.
  userRoleId: string;
}

// Case-insensitive: Google accounts are case-preserving, and password-login
// identifiers shouldn't be case-sensitive either — matches the convention already
// used elsewhere for Airtable email lookups.
async function findUserRoleRecord(identifier: string, fields: (keyof UserRoleFields)[]) {
  const escaped = identifier.replace(/'/g, "\\'");
  const records = await listRecords<UserRoleFields>(TABLES.userRoles, {
    filterByFormula: `LOWER({Email}) = LOWER('${escaped}')`,
    fields,
  });
  return records[0] ?? null;
}

async function resolveAccessForRoleRecordId(
  roleRecordId: string | undefined
): Promise<Omit<UserAccess, "userRoleId"> | null> {
  if (!roleRecordId) return null;
  const roleRecord = await getRecordOrNull<RolePermissionFields>(TABLES.rolePermissions, roleRecordId);
  if (!roleRecord?.fields.Role) return null;

  return {
    role: roleRecord.fields.Role as UserRole,
    permissions: ALL_PERMISSIONS.filter((p) => roleRecord.fields[p]),
  };
}

export async function getAccessForEmail(email: string): Promise<UserAccess | null> {
  const userRoleRecord = await findUserRoleRecord(email, ["Role"]);
  if (!userRoleRecord) return null;
  const access = await resolveAccessForRoleRecordId(userRoleRecord.fields.Role?.[0]);
  if (!access) return null;
  return { ...access, userRoleId: userRoleRecord.id };
}

// Fetches "Password Hash" too — unlike getAccessForEmail, which never pulls that
// field since every OAuth login goes through it and never needs it.
export async function getPasswordAuthForIdentifier(
  identifier: string
): Promise<(UserAccess & { passwordHash: string }) | null> {
  const userRoleRecord = await findUserRoleRecord(identifier, ["Role", "Password Hash"]);
  const passwordHash = userRoleRecord?.fields["Password Hash"];
  if (!userRoleRecord || !passwordHash) return null;

  const access = await resolveAccessForRoleRecordId(userRoleRecord.fields.Role?.[0]);
  if (!access) return null;

  return { ...access, userRoleId: userRoleRecord.id, passwordHash };
}

// Resolves a Google login to a *student's own* record, for the separate read-only
// student app (server/src/studentApp.ts) — a completely different lookup path from
// everything else in this file: Members, not User Roles, and no permissions/role
// resolution at all (a Student session is identity-scoped, not permission-based; see
// lib/session.ts's studentId). Excludes Duplicate-flagged records, same filter
// services/studentStatus.ts's listStudentStatuses already uses for the same reason
// (Givebutter contact-merge artifacts, not real distinct members).
export async function getStudentAccessForEmail(email: string): Promise<{ studentId: string } | null> {
  const escaped = email.replace(/'/g, "\\'");
  const records = await listRecords<MemberFields>(TABLES.members, {
    filterByFormula: `AND(LOWER({Email}) = LOWER('${escaped}'), NOT({Duplicate}))`,
    fields: ["Email"],
  });
  const member = records[0];
  return member ? { studentId: member.id } : null;
}
