import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { LevelupFields } from "../airtable/fields.js";
import { updateStudentLevel } from "./levelups.js";

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
