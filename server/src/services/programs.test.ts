import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { listActivePrograms } from "./programs.js";

describe("listActivePrograms", () => {
  it("excludes non-Active programs", async () => {
    resetMockStore({
      [TABLES.programs]: [
        { id: "recActive", fields: { "Program Name": "Zouk L1", Status: "Active" } },
        { id: "recPlanned", fields: { "Program Name": "Zouk L5", Status: "Planned" } },
        { id: "recCanceled", fields: { "Program Name": "Zouk L6", Status: "Canceled" } },
      ],
    });
    const programs = await listActivePrograms();
    assert.deepEqual(programs.map((p) => p.id), ["recActive"]);
  });

  it("sorts by start time, then by name within the same slot", async () => {
    resetMockStore({
      [TABLES.programs]: [
        { id: "recLate", fields: { "Program Name": "Zouk L2", Status: "Active", "Start Time": "20:00" } },
        { id: "recEarlyB", fields: { "Program Name": "Zouk L1B", Status: "Active", "Start Time": "19:00" } },
        { id: "recEarlyA", fields: { "Program Name": "Zouk L1A", Status: "Active", "Start Time": "19:00" } },
      ],
    });
    const programs = await listActivePrograms();
    assert.deepEqual(programs.map((p) => p.id), ["recEarlyA", "recEarlyB", "recLate"]);
  });

  it("parses comma-separated Skip Dates, trimming whitespace and dropping empties", async () => {
    resetMockStore({
      [TABLES.programs]: [
        {
          id: "recProgram1",
          fields: { "Program Name": "Zouk L1", Status: "Active", "Skip Dates": "2025-12-25, 2026-01-01 ,," },
        },
      ],
    });
    const [program] = await listActivePrograms();
    assert.deepEqual(program.skipDates, ["2025-12-25", "2026-01-01"]);
  });

  it("defaults skipDates/weekdays to empty and startDate/endDate/startTime/visibleForSeconds to null when unset", async () => {
    resetMockStore({
      [TABLES.programs]: [{ id: "recProgram1", fields: { "Program Name": "Zouk L1", Status: "Active" } }],
    });
    const [program] = await listActivePrograms();
    assert.deepEqual(program.weekdays, []);
    assert.deepEqual(program.skipDates, []);
    assert.equal(program.startDate, null);
    assert.equal(program.endDate, null);
    assert.equal(program.startTime, null);
    assert.equal(program.visibleForSeconds, null);
  });
});
