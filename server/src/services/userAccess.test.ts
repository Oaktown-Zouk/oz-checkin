import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { getAccessForEmail, getPasswordAuthForIdentifier, getStudentAccessForEmail } from "./userAccess.js";

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
      {
        id: "recUserKioskTablet",
        fields: { Email: "front-desk-kiosk", Role: ["recRoleKiosk"], "Password Hash": "scrypt:16384:8:1:aa:bb" },
      },
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

  it("includes the User Roles row's own record id", async () => {
    seedRoles();
    const access = await getAccessForEmail("kiosk@example.com");
    assert.equal(access?.userRoleId, "recUserKiosk");
  });

  it("matches email case-insensitively", async () => {
    seedRoles();
    const access = await getAccessForEmail("admin@example.com");
    assert.equal(access?.role, "Admin");
    assert.ok(access?.permissions.includes("Backdate Kiosk"));
  });
});

describe("getPasswordAuthForIdentifier", () => {
  it("returns role/permissions plus the stored hash for an identifier with a password set", async () => {
    seedRoles();
    const auth = await getPasswordAuthForIdentifier("front-desk-kiosk");
    assert.equal(auth?.role, "Kiosk");
    assert.deepEqual(auth?.permissions.sort(), ["Create Checkins", "Undo Checkins"]);
    assert.equal(auth?.passwordHash, "scrypt:16384:8:1:aa:bb");
    assert.equal(auth?.userRoleId, "recUserKioskTablet");
  });

  it("matches the identifier case-insensitively, same as email lookups", async () => {
    seedRoles();
    const auth = await getPasswordAuthForIdentifier("Front-Desk-Kiosk");
    assert.equal(auth?.role, "Kiosk");
  });

  it("returns null for a User Roles row with no Password Hash set (an OAuth-only row)", async () => {
    seedRoles();
    assert.equal(await getPasswordAuthForIdentifier("kiosk@example.com"), null);
  });

  it("returns null for an identifier with no User Roles row at all", async () => {
    seedRoles();
    assert.equal(await getPasswordAuthForIdentifier("nobody"), null);
  });
});

describe("getStudentAccessForEmail", () => {
  function seedMembers() {
    resetMockStore({
      [TABLES.members]: [
        {
          id: "recMemberKeep",
          fields: { "Full Name": "Keep Me", Email: "student@example.com", Transactions: ["recTxn1"] },
        },
        {
          id: "recMemberDup",
          fields: {
            "Full Name": "Duplicate Dana",
            Email: "dupe@example.com",
            Duplicate: true,
            Transactions: ["recTxn2"],
          },
        },
        {
          id: "recMemberPlanOnly",
          fields: { "Full Name": "Plan Paula", Email: "plan-only@example.com", "Recurring Plans": ["recPlan1"] },
        },
        {
          id: "recMemberNoActivity",
          fields: { "Full Name": "Lead Leo", Email: "lead-only@example.com" },
        },
      ],
    });
  }

  it("finds a Member by email and returns its record id", async () => {
    seedMembers();
    const access = await getStudentAccessForEmail("student@example.com");
    assert.deepEqual(access, { studentId: "recMemberKeep" });
  });

  it("matches email case-insensitively", async () => {
    seedMembers();
    const access = await getStudentAccessForEmail("Student@Example.com");
    assert.deepEqual(access, { studentId: "recMemberKeep" });
  });

  it("excludes Duplicate-flagged members", async () => {
    seedMembers();
    assert.equal(await getStudentAccessForEmail("dupe@example.com"), null);
  });

  it("returns null for an email with no matching Member", async () => {
    seedMembers();
    assert.equal(await getStudentAccessForEmail("nobody@example.com"), null);
  });

  it("finds a Member via a Recurring Plan even with no Transactions", async () => {
    seedMembers();
    const access = await getStudentAccessForEmail("plan-only@example.com");
    assert.deepEqual(access, { studentId: "recMemberPlanOnly" });
  });

  it("rejects a Member with neither a Transaction nor a Recurring Plan (contact info only, never paid)", async () => {
    seedMembers();
    assert.equal(await getStudentAccessForEmail("lead-only@example.com"), null);
  });
});
