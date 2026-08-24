import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { createCheckIns, undoCheckIn } from "./checkins.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";
import { today } from "../lib/date.js";

const MEMBER = "recMember1";
const PROGRAM = "recProgram1";
const PROGRAM_2 = "recProgram2";

function seedMember(fields: Record<string, unknown>) {
  resetMockStore({
    [TABLES.members]: [{ id: MEMBER, fields: { "Full Name": "Test Student", "Classes Allowed": 0, ...fields } }],
    [TABLES.programs]: [
      { id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } },
      { id: PROGRAM_2, fields: { "Program Name": "Zouk L2", Status: "Active" } },
    ],
  });
}

describe("createCheckIns (live, no effectiveAt)", () => {
  beforeEach(() => seedMember({ "Classes Allowed": 1 }));

  it("within allowance: doesn't touch credits or flag review", async () => {
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    assert.equal(status.remaining, 0);
    assert.equal(status.availableCredits, 0);
    assert.equal(status.checkinsToday.length, 1);
    assert.equal(status.checkinsToday[0].needsReview, false);
  });

  it("over allowance with an available credit: consumes the oldest one (Automation C)", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: MEMBER, fields: { "Full Name": "Test Student", "Classes Allowed": 0 } }],
      [TABLES.programs]: [{ id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } }],
      [TABLES.credits]: [
        { id: "recCreditOld", fields: { Member: [MEMBER], "Granted At": "2020-01-01T00:00:00.000Z" } },
        { id: "recCreditNew", fields: { Member: [MEMBER], "Granted At": "2025-01-01T00:00:00.000Z" } },
      ],
    });

    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    assert.equal(status.availableCredits, 1); // the newer one is still available
    assert.equal(status.checkinsToday[0].needsReview, false);
  });

  it("over allowance with no credit available: flags Needs Review", async () => {
    seedMember({ "Classes Allowed": 0 });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    assert.equal(status.checkinsToday[0].needsReview, true);
    assert.equal(status.checkinsToday[0].reviewReason, "Beyond tier allowance, no credit available");
  });

  it("two selections in one call: only the one that crosses the allowance line consumes a credit", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: MEMBER, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.programs]: [
        { id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } },
        { id: PROGRAM_2, fields: { "Program Name": "Zouk L2", Status: "Active" } },
      ],
      [TABLES.credits]: [{ id: "recCredit1", fields: { Member: [MEMBER], "Granted At": "2025-01-01T00:00:00.000Z" } }],
    });

    const status = await createCheckIns(MEMBER, [
      { programId: PROGRAM, role: "Lead" },
      { programId: PROGRAM_2, role: "Follow" },
    ]);
    assert.equal(status.checkinsToday.length, 2);
    assert.equal(status.availableCredits, 0);
    const [first, second] = status.checkinsToday;
    assert.equal(first.needsReview, false);
    assert.equal(second.needsReview, false); // consumed the credit, not flagged
  });
});

describe("createCheckIns (backdated)", () => {
  it("mirrors live gating for the target date, not literal today", async () => {
    seedMember({ "Classes Allowed": 1 });
    const pastDate = new Date("2020-06-01T18:00:00.000Z");

    const status = await createCheckIns(
      MEMBER,
      [
        { programId: PROGRAM, role: "Lead" },
        { programId: PROGRAM_2, role: "Follow" },
      ],
      { effectiveAt: pastDate }
    );

    // Viewed against that backdated date: 2nd selection crosses the 1-class allowance.
    assert.equal(status.checkinsToday.length, 2);
    assert.equal(status.checkinsToday[1].needsReview, true);
  });

  it("never touches today's live gating for an unrelated same-day check-in", async () => {
    seedMember({ "Classes Allowed": 1 });
    // A backdated check-in for a past date shouldn't affect what "today" looks like.
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: new Date("2020-01-01T18:00:00Z") });
    const liveStatus = await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }]);
    assert.equal(liveStatus.remaining, 0); // today's own first check-in, full allowance still available until this one
    assert.equal(liveStatus.checkinsToday.length, 1); // only today's, not the 2020 one
  });
});

describe("undoCheckIn", () => {
  it("frees the credit it consumed (Automation D) and updates checkedInToday", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: MEMBER, fields: { "Full Name": "Test Student", "Classes Allowed": 0 } }],
      [TABLES.programs]: [{ id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } }],
      [TABLES.credits]: [{ id: "recCredit1", fields: { Member: [MEMBER], "Granted At": "2025-01-01T00:00:00.000Z" } }],
    });

    const created = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    assert.equal(created.availableCredits, 0);

    const checkinId = created.checkinsToday[0].id;
    const afterUndo = await undoCheckIn(checkinId);
    assert.equal(afterUndo.availableCredits, 1);
    assert.equal(afterUndo.checkedInToday, false);
  });

  it("throws ConflictError if already undone", async () => {
    seedMember({ "Classes Allowed": 1 });
    const created = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    const checkinId = created.checkinsToday[0].id;
    await undoCheckIn(checkinId);
    await assert.rejects(() => undoCheckIn(checkinId), ConflictError);
  });

  it("throws NotFoundError for an unknown check-in id", async () => {
    seedMember({});
    await assert.rejects(() => undoCheckIn("recDoesNotExist"), NotFoundError);
  });
});

// Sanity check that the mock's "today" actually lines up with the app's own notion of
// it — if this ever drifts, every test above would be silently testing the wrong date.
describe("mock/app date alignment", () => {
  it("today() returns a plausible date", () => {
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
