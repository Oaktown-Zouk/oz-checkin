// Default fixture data for the mock — used both as the sandbox's self-seed (see
// mockClient.ts's ensureSeeded) and as a ready-made starting point for tests/E2E
// specs that don't need a fully custom scenario. FIXTURE_IDS gives stable handles to
// reference specific records without hardcoding magic strings at every call site.
import { TABLES } from "./tableIds.js";
import type { SeedData } from "./mockCompute.js";

// Every weekday, no date-range restriction — so the sandbox always has active
// classes today no matter when it's actually run.
const ALL_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A password-login (kiosk tablet) User Roles row. The identifier/password are
// plaintext test fixtures; the hash below is a real hashPassword("kiosk-test-password-1234")
// output, precomputed once so the seed stays static — see e2e/kiosk-password-login.spec.ts.
export const KIOSK_PASSWORD_LOGIN = {
  identifier: "kiosk-tablet",
  password: "kiosk-test-password-1234",
  passwordHash:
    "scrypt:16384:8:1:65572757b0ea16ecc21fe6d6fb31fb7b:f1ea175e0a3c5145af286d6aad92d4acb88f07263fb7377cf86bec374eeef20ffc94d6639f4cd8938b1012bb6b0d98f35c9bdaac4d77cd11533a02de25e30a44",
} as const;

export const FIXTURE_IDS = {
  members: {
    // Active membership, full allowance untouched — the "everything works" case.
    activeAmy: "recMemberActiveAmy",
    // Trial/credit-only, no recurring membership at all.
    trialTina: "recMemberTrialTina",
    // Active membership, but already used today's one allowed class and has no
    // credit to fall back on — the kiosk "already checked in" decline case.
    checkedInChris: "recMemberCheckedInChris",
    // Lapsed membership, no credits — the "please see the front desk" decline case.
    lapsedLarry: "recMemberLapsedLarry",
    // Flagged Duplicate — must never appear in the roster.
    duplicateDana: "recMemberDuplicateDana",
    // The web-student/ dev-login fixture (server/src/studentApp.ts's
    // DEV_LOGIN_STUDENT_EMAIL) — not reused by any staff-facing test, so its data
    // shape is free to change without risk of colliding with what other specs assume.
    testStudent: "recMemberTestStudent",
  },
  programs: {
    zoukL1: "recProgramZoukL1",
    zoukL2: "recProgramZoukL2",
  },
  credits: {
    trialTinaCredit: "recCreditTrialTina",
  },
  recurringPlans: {
    activeAmyPlan: "recPlanActiveAmy",
  },
  checkins: {
    checkedInChrisToday: "recCheckinChrisToday",
  },
  rolePermissions: {
    staff: "recRolePermStaff",
    volunteer: "recRolePermVolunteer",
    kiosk: "recRolePermKiosk",
    admin: "recRolePermAdmin",
  },
} as const;

export function buildSandboxSeed(): SeedData {
  const { members, programs, credits, recurringPlans, checkins, rolePermissions } = FIXTURE_IDS;
  const nowIso = new Date().toISOString();
  const todayAt = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  return {
    [TABLES.members]: [
      {
        id: members.activeAmy,
        fields: {
          "Full Name": "Active Amy",
          Email: "amy@example.com",
          "Contact ID": "contact-amy",
          "Access Status": "Active",
          "Membership Status": "Active",
          "Tier Name": "2 Class",
          "Classes Allowed": 2,
          "Recently Active": 1,
        },
      },
      {
        id: members.trialTina,
        fields: {
          "Full Name": "Trial Tina",
          Email: "tina@example.com",
          "Contact ID": "contact-tina",
          "Access Status": "Trial",
          "Membership Status": "Prospect",
          "Tier Name": null,
          "Classes Allowed": 0,
          "Recently Active": 0,
        },
      },
      {
        id: members.checkedInChris,
        fields: {
          "Full Name": "Checked-In Chris",
          Email: "chris@example.com",
          "Contact ID": "contact-chris",
          "Access Status": "Active",
          "Membership Status": "Active",
          "Tier Name": "1 Class",
          "Classes Allowed": 1,
          "Recently Active": 1,
        },
      },
      {
        id: members.lapsedLarry,
        fields: {
          "Full Name": "Lapsed Larry",
          Email: "larry@example.com",
          "Contact ID": "contact-larry",
          "Access Status": "Inactive",
          "Membership Status": "Lapsed / Donor",
          "Tier Name": null,
          "Classes Allowed": 0,
          "Recently Active": 0,
        },
      },
      {
        id: members.duplicateDana,
        fields: {
          "Full Name": "Duplicate Dana",
          Email: "dana@example.com",
          "Access Status": "Active",
          "Membership Status": "Active",
          "Tier Name": "1 Class",
          "Classes Allowed": 1,
          Duplicate: true,
          "Recently Active": 1,
        },
      },
      {
        id: members.testStudent,
        fields: {
          "Full Name": "Claude Test Student",
          Email: "claude-student@test.com",
          "Contact ID": "contact-test-student",
          "Access Status": "Active",
          "Membership Status": "Active",
          "Tier Name": "2 Class",
          "Classes Allowed": 2,
          "Lead Level": 2,
          "Recently Active": 1,
        },
      },
    ],
    [TABLES.programs]: [
      {
        id: programs.zoukL1,
        fields: {
          "Program Name": "Zouk L1",
          Status: "Active",
          Weekdays: ALL_WEEKDAYS,
          "Start Time": "19:00",
          // Deliberately no "Visible For" here — the default seed needs both programs
          // to be reliably clickable in the kiosk regardless of what time a test or
          // sandbox session happens to run. A spec that wants to exercise the kiosk's
          // Visible For cutoff should seed its own program with a time relative to a
          // controlled effectiveAt (Backdate Kiosk), not depend on the real clock.
        },
      },
      {
        id: programs.zoukL2,
        fields: {
          "Program Name": "Zouk L2",
          Status: "Active",
          Weekdays: ALL_WEEKDAYS,
          "Start Time": "20:00",
        },
      },
    ],
    [TABLES.credits]: [
      {
        id: credits.trialTinaCredit,
        fields: {
          Member: [members.trialTina],
          Reason: "New Member",
          "Granted At": nowIso,
        },
      },
    ],
    [TABLES.recurringPlans]: [
      {
        id: recurringPlans.activeAmyPlan,
        fields: {
          "Plan ID": "plan-amy",
          Status: "active",
          Amount: 120,
          Frequency: "monthly",
          Member: [members.activeAmy],
          "Covers Member": [members.activeAmy],
        },
      },
    ],
    [TABLES.checkins]: [
      {
        id: checkins.checkedInChrisToday,
        fields: {
          Member: [members.checkedInChris],
          "Checked In At": todayAt("18:00"),
          "Class Level": [programs.zoukL1],
          Role: "Lead",
        },
      },
    ],
    [TABLES.rolePermissions]: [
      {
        id: rolePermissions.staff,
        fields: {
          Role: "Staff",
          "View Student Data": true,
          "Write Student Data": true,
          "Create Checkins": true,
          "Undo Checkins": true,
          "Write Memberships": true,
        },
      },
      {
        id: rolePermissions.volunteer,
        fields: {
          Role: "Volunteer",
          "View Student Data": true,
          "Write Student Data": true,
          "Create Checkins": true,
          "Undo Checkins": true,
        },
      },
      {
        id: rolePermissions.kiosk,
        fields: {
          Role: "Kiosk",
          "Create Checkins": true,
          "Undo Checkins": true,
        },
      },
      {
        id: rolePermissions.admin,
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
      { id: "recUserRoleStaff", fields: { Email: "claude-staff@test.com", Role: [rolePermissions.staff] } },
      { id: "recUserRoleVolunteer", fields: { Email: "claude-volunteer@test.com", Role: [rolePermissions.volunteer] } },
      { id: "recUserRoleKiosk", fields: { Email: "claude-kiosk@test.com", Role: [rolePermissions.kiosk] } },
      { id: "recUserRoleAdmin", fields: { Email: "claude-admin@test.com", Role: [rolePermissions.admin] } },
      {
        id: "recUserRoleKioskTablet",
        fields: {
          Email: KIOSK_PASSWORD_LOGIN.identifier,
          Role: [rolePermissions.kiosk],
          "Password Hash": KIOSK_PASSWORD_LOGIN.passwordHash,
        },
      },
    ],
  };
}
