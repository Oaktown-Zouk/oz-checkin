import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { listStudentStatuses, getStudentStatusById } from "./studentStatus.js";

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
