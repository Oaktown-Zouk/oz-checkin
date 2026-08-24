import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { getAccessForEmail } from "./userAccess.js";

function seedRoles() {
  resetMockStore({
    [TABLES.rolePermissions]: [
      {
        id: "recRoleKiosk",
        fields: { Role: "Kiosk", "Create Checkins": true, "Undo Checkins": true },
      },
      {
        id: "recRoleAdmin",
        fields: {
          Role: "Admin",
          "View Student Data": true,
          "Write Student Data": true,
          "Create Checkins": true,
          "Undo Checkins": true,
          "Write Memberships": true,
          "Backdate Kiosk": true,
        },
      },
    ],
    [TABLES.userRoles]: [
      { id: "recUserKiosk", fields: { Email: "kiosk@example.com", Role: ["recRoleKiosk"] } },
      { id: "recUserAdmin", fields: { Email: "Admin@Example.com", Role: ["recRoleAdmin"] } },
    ],
  });
}

describe("getAccessForEmail", () => {
  it("returns null for an email with no User Roles row", async () => {
    seedRoles();
    assert.equal(await getAccessForEmail("nobody@example.com"), null);
  });

  it("resolves a role's exact permission set, omitting unchecked ones", async () => {
    seedRoles();
    const access = await getAccessForEmail("kiosk@example.com");
    assert.equal(access?.role, "Kiosk");
    assert.deepEqual(access?.permissions.sort(), ["Create Checkins", "Undo Checkins"]);
  });

  it("matches email case-insensitively", async () => {
    seedRoles();
    const access = await getAccessForEmail("admin@example.com");
    assert.equal(access?.role, "Admin");
    assert.ok(access?.permissions.includes("Backdate Kiosk"));
  });
});
