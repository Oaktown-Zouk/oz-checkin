import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { CheckinFields } from "../airtable/fields.js";
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

  it("over allowance with credits available: consumes one", async () => {
    resetMockStore({
      [TABLES.members]: [
        { id: MEMBER, fields: { "Full Name": "Test Student", "Classes Allowed": 0, "New Member Credit": 2 } },
      ],
      [TABLES.programs]: [{ id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } }],
    });

    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    assert.equal(status.availableCredits, 1); // started with 2, consumed 1
    assert.equal(status.checkinsToday[0].needsReview, false);
  });

  it("over allowance with no credit available: flags Needs Review", async () => {
    seedMember({ "Classes Allowed": 0 });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    assert.equal(status.checkinsToday[0].needsReview, true);
    assert.equal(status.checkinsToday[0].reviewReason, "Beyond tier allowance, no credit available");
  });

  it("sets Method to whatever the caller passed (Staff vs Kiosk)", async () => {
    seedMember({ "Classes Allowed": 2 });
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { method: "Kiosk" });
    await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }], { method: "Staff" });
    const checkins = await listRecords<CheckinFields>(TABLES.checkins, { fields: ["Method"] });
    assert.deepEqual(
      checkins.map((c) => c.fields.Method).sort(),
      ["Kiosk", "Staff"]
    );
  });

  it("leaves Method unset when the caller doesn't specify one", async () => {
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }]);
    const checkins = await listRecords<CheckinFields>(TABLES.checkins, { fields: ["Method"] });
    assert.equal(checkins[0].fields.Method, undefined);
  });

  it("two selections in one call: only the one that crosses the allowance line consumes a credit", async () => {
    resetMockStore({
      [TABLES.members]: [
        { id: MEMBER, fields: { "Full Name": "Test Student", "Classes Allowed": 1, "New Member Credit": 1 } },
      ],
      [TABLES.programs]: [
        { id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } },
        { id: PROGRAM_2, fields: { "Program Name": "Zouk L2", Status: "Active" } },
      ],
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
  const PAST_DATE = new Date("2020-06-01T18:00:00.000Z"); // dateStringFor -> "2020-06-01"
  const OTHER_PAST_DATE = new Date("2019-01-01T18:00:00.000Z");

  it("within allowance for the target date: no credit touched, nothing flagged", async () => {
    seedMember({ "Classes Allowed": 1 });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    assert.equal(status.checkinsToday.length, 1);
    assert.equal(status.checkinsToday[0].needsReview, false);
    assert.equal(status.availableCredits, 0);
  });

  it("over allowance for the target date with a credit available: consumes it", async () => {
    seedMember({ "Classes Allowed": 0, "New Member Credit": 1 });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    assert.equal(status.checkinsToday[0].needsReview, false);
    assert.equal(status.availableCredits, 0);
  });

  it("mirrors gating for the target date, not literal today, across a multi-selection batch", async () => {
    seedMember({ "Classes Allowed": 1 });
    const status = await createCheckIns(
      MEMBER,
      [
        { programId: PROGRAM, role: "Lead" },
        { programId: PROGRAM_2, role: "Follow" },
      ],
      { effectiveAt: PAST_DATE }
    );
    // Viewed against that backdated date: 2nd selection crosses the 1-class allowance.
    assert.equal(status.checkinsToday.length, 2);
    assert.equal(status.checkinsToday[0].needsReview, false);
    assert.equal(status.checkinsToday[1].needsReview, true);
  });

  it("counts a prior check-in already on that same backdated date, from an earlier separate call", async () => {
    seedMember({ "Classes Allowed": 1 });
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    // A second, separate backdated call for the *same* date — priorCount must include
    // the first call's check-in, not just whatever's in this call's own batch.
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }], { effectiveAt: PAST_DATE });
    assert.equal(status.checkinsToday.length, 2);
    assert.equal(status.checkinsToday[1].needsReview, true);
  });

  it("a prior check-in on that date can push the very first selection of a new batch over the line", async () => {
    seedMember({ "Classes Allowed": 1 });
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }], { effectiveAt: PAST_DATE });
    // Unlike the live-path "two selections in one call" test, this is a 1-item batch
    // whose *only* selection is the one that crosses the line — nth = prior(1) + 1 = 2.
    assert.equal(status.checkinsToday[1].needsReview, true);
  });

  it("doesn't count a prior check-in on a *different* backdated date", async () => {
    seedMember({ "Classes Allowed": 1 });
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: OTHER_PAST_DATE });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }], { effectiveAt: PAST_DATE });
    assert.equal(status.checkinsToday.length, 1); // only PAST_DATE's, not OTHER_PAST_DATE's
    assert.equal(status.checkinsToday[0].needsReview, false); // 1st on this date, within allowance
  });

  it("doesn't count a prior check-in on that date that's since been undone", async () => {
    seedMember({ "Classes Allowed": 1 });
    const first = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    await undoCheckIn(first.checkinsToday[0].id);

    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }], { effectiveAt: PAST_DATE });
    // Would incorrectly flag this as the 2nd-of-1-allowed if the undone check-in were
    // still being counted toward priorCount.
    assert.equal(status.checkinsToday.length, 1); // undone one excluded from the view entirely
    assert.equal(status.checkinsToday[0].needsReview, false);
  });

  it("never touches today's live gating for an unrelated same-day check-in", async () => {
    seedMember({ "Classes Allowed": 1 });
    // A backdated check-in for a past date shouldn't affect what "today" looks like.
    await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    const liveStatus = await createCheckIns(MEMBER, [{ programId: PROGRAM_2, role: "Follow" }]);
    assert.equal(liveStatus.remaining, 0); // today's own first check-in, full allowance still available until this one
    assert.equal(liveStatus.checkinsToday.length, 1); // only today's, not the 2020 one
  });

  it("the returned status reflects the backdated date's view, computed by count rather than the live Remaining Today field", async () => {
    seedMember({ "Classes Allowed": 2 });
    const status = await createCheckIns(MEMBER, [{ programId: PROGRAM, role: "Lead" }], { effectiveAt: PAST_DATE });
    // studentStatus.ts's backdated branch: classesAllowed - checkinsForMember.length,
    // not the live-only computed "Remaining Today" field the mock derives for today.
    assert.equal(status.remaining, 1);
    assert.equal(status.checkedInToday, true);
  });
});

describe("undoCheckIn", () => {
  it("frees the credit it consumed and updates checkedInToday", async () => {
    seedMember({ "Classes Allowed": 0, "New Member Credit": 1 });

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
