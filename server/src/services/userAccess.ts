import { listRecords, getRecordOrNull, TABLES } from "../airtable/client.js";
import type { UserRoleFields, RolePermissionFields, UserRole, Permission } from "../airtable/fields.js";

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
}

// Case-insensitive: Google accounts are case-preserving but comparisons should ignore
// case, matching the convention used elsewhere for Airtable email lookups.
export async function getAccessForEmail(email: string): Promise<UserAccess | null> {
  const escaped = email.replace(/'/g, "\\'");
  const userRoleRecords = await listRecords<UserRoleFields>(TABLES.userRoles, {
    filterByFormula: `LOWER({Email}) = LOWER('${escaped}')`,
    fields: ["Role"],
  });
  const roleRecordId = userRoleRecords[0]?.fields.Role?.[0];
  if (!roleRecordId) return null;

  const roleRecord = await getRecordOrNull<RolePermissionFields>(TABLES.rolePermissions, roleRecordId);
  if (!roleRecord?.fields.Role) return null;

  return {
    role: roleRecord.fields.Role as UserRole,
    permissions: ALL_PERMISSIONS.filter((p) => roleRecord.fields[p]),
  };
}
