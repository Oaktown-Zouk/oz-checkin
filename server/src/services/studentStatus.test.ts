import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { LevelupFields } from "../airtable/fields.js";
import { listStudentStatuses, getStudentStatusById, updateStudentLevel } from "./studentStatus.js";

describe("listStudentStatuses", () => {
  it("excludes Duplicate-flagged members from the roster", async () => {
    resetMockStore({
      [TABLES.members]: [
        { id: "recKeep", fields: { "Full Name": "Keep Me", "Classes Allowed": 1 } },
        { id: "recDup", fields: { "Full Name": "Duplicate Dana", "Classes Allowed": 1, Duplicate: true } },
      ],
    });

    const statuses = await listStudentStatuses();
    assert.deepEqual(
      statuses.map((s) => s.id),
      ["recKeep"]
    );
  });

  it("sorts checked-in-today students to the bottom, then recently-active above stale", async () => {
    resetMockStore({
      [TABLES.members]: [
        { id: "recStale", fields: { "Full Name": "Stale Sam", "Classes Allowed": 1, "Recently Active": 0 } },
        { id: "recActive", fields: { "Full Name": "Active Amy", "Classes Allowed": 1, "Recently Active": 1 } },
        { id: "recCheckedIn", fields: { "Full Name": "Checked-In Chris", "Classes Allowed": 1, "Recently Active": 1 } },
      ],
      [TABLES.checkins]: [
        {
          id: "recCheckin1",
          fields: { Member: ["recCheckedIn"], "Checked In At": new Date().toISOString() },
        },
      ],
    });

    const statuses = await listStudentStatuses();
    assert.deepEqual(
      statuses.map((s) => s.id),
      ["recActive", "recStale", "recCheckedIn"]
    );
  });
});

describe("getStudentStatusById", () => {
  it("returns null for an unknown id", async () => {
    resetMockStore({});
    assert.equal(await getStudentStatusById("recNope"), null);
  });

  it("computes remaining/availableCredits/checkedInToday for a real member", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 2 } }],
    });
    const status = await getStudentStatusById("recMember1");
    assert.equal(status?.remaining, 2);
    assert.equal(status?.availableCredits, 0);
    assert.equal(status?.checkedInToday, false);
  });
});

describe("updateStudentLevel", () => {
  it("writes Lead Level and returns the updated status", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1, "Lead Level": null } }],
    });
    const updated = await updateStudentLevel("recMember1", "Lead Level", 3, "recIssuer1");
    assert.equal(updated.leadLevel, 3);
  });

  it("logs a Levelups record with no From on a student's first level in that role", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
    });
    await updateStudentLevel("recMember1", "Lead Level", 2, "recIssuer1");

    const levelups = await listRecords<LevelupFields>(TABLES.levelups);
    assert.equal(levelups.length, 1);
    assert.deepEqual(levelups[0].fields, { Member: ["recMember1"], Issuer: ["recIssuer1"], Role: "Lead", To: 2 });
  });

  it("logs a Levelups record with both From and To when changing an existing level", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1, "Follow Level": 1 } }],
    });
    await updateStudentLevel("recMember1", "Follow Level", 2, "recIssuer1");

    const levelups = await listRecords<LevelupFields>(TABLES.levelups);
    assert.equal(levelups.length, 1);
    assert.deepEqual(levelups[0].fields, { Member: ["recMember1"], Issuer: ["recIssuer1"], Role: "Follow", From: 1, To: 2 });
  });

  it("logs a Levelups record with From but no To when a level is cleared back to unset", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1, "Lead Level": 3 } }],
    });
    await updateStudentLevel("recMember1", "Lead Level", null, "recIssuer1");

    const levelups = await listRecords<LevelupFields>(TABLES.levelups);
    assert.equal(levelups.length, 1);
    assert.deepEqual(levelups[0].fields, { Member: ["recMember1"], Issuer: ["recIssuer1"], Role: "Lead", From: 3 });
  });

  it("doesn't log a Levelups record when the level is unchanged", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1, "Lead Level": 2 } }],
    });
    await updateStudentLevel("recMember1", "Lead Level", 2, "recIssuer1");

    assert.deepEqual(await listRecords<LevelupFields>(TABLES.levelups), []);
  });
});
