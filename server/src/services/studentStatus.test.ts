import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { listStudentStatuses, getStudentStatusById, computeLastCheckinSelections } from "./studentStatus.js";
import type { AirtableRecord } from "../airtable/client.js";
import type { CheckinFields } from "../airtable/fields.js";

function checkin(daysAgo: number, programId: string, role: "Lead" | "Follow"): AirtableRecord<CheckinFields> {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - daysAgo);
  return {
    id: `rec${daysAgo}_${programId}_${role}`,
    createdTime: at.toISOString(),
    fields: { "Checked In At": at.toISOString(), "Class Level": [programId], Role: role },
  };
}

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

describe("computeLastCheckinSelections", () => {
  it("returns the most recent visit's selections when it was within the last week", () => {
    const selections = computeLastCheckinSelections([checkin(2, "recProgram1", "Lead")]);
    assert.deepEqual(selections, [{ programId: "recProgram1", role: "Lead" }]);
  });

  it("returns an empty array when the most recent visit was more than a week ago", () => {
    const selections = computeLastCheckinSelections([checkin(10, "recProgram1", "Lead")]);
    assert.deepEqual(selections, []);
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
