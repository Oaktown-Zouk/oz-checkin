// Sets (or rotates) the shared kiosk-tablet login password. Usage:
//   npx tsx src/scripts/setKioskPassword.ts <identifier> <newPassword>
//
// <identifier> is a User Roles row's "Email" value — for a kiosk login it doesn't need
// to look like a real email, it's just the plain-text field password-login already
// keys off of (see getPasswordAuthForIdentifier, services/userAccess.ts). If no row
// exists yet for that identifier, one is created and linked to the existing "Kiosk"
// Role Permissions row; if one does exist, only its Password Hash is updated.
import { listRecords, createRecords, updateRecord, TABLES } from "../airtable/client.js";
import type { UserRoleFields, RolePermissionFields } from "../airtable/fields.js";
import { hashPassword } from "../lib/password.js";

async function main() {
  const [identifier, newPassword] = process.argv.slice(2);
  if (!identifier || !newPassword) {
    console.error("Usage: npx tsx src/scripts/setKioskPassword.ts <identifier> <newPassword>");
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  const escaped = identifier.replace(/'/g, "\\'");
  const existing = await listRecords<UserRoleFields>(TABLES.userRoles, {
    filterByFormula: `LOWER({Email}) = LOWER('${escaped}')`,
    fields: ["Email"],
  });

  if (existing[0]) {
    await updateRecord<UserRoleFields>(TABLES.userRoles, existing[0].id, { "Password Hash": passwordHash });
    console.log(`Updated password for existing User Roles row (${identifier}).`);
    return;
  }

  const kioskRoles = await listRecords<RolePermissionFields>(TABLES.rolePermissions, {
    filterByFormula: `{Role} = 'Kiosk'`,
    fields: ["Role"],
  });
  const kioskRoleId = kioskRoles[0]?.id;
  if (!kioskRoleId) {
    console.error(`No "Kiosk" row found in Role Permissions — can't link a new User Roles row.`);
    process.exit(1);
  }

  await createRecords<UserRoleFields>(TABLES.userRoles, [
    { Email: identifier, Role: [kioskRoleId], "Password Hash": passwordHash },
  ]);
  console.log(`Created new User Roles row for "${identifier}" with the Kiosk role.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
