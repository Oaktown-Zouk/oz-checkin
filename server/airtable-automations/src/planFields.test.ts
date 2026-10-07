import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRecurringPlanFields, shouldAssignCoversMember } from "./planFields.js";

describe("buildRecurringPlanFields", () => {
  it("maps a Givebutter plan payload to Airtable field names", () => {
    const fields = buildRecurringPlanFields(
      {
        id: 12345,
        status: "active",
        amount: 165,
        frequency: "monthly",
        method: "card",
        fee_covered: true,
        start_at: "2026-09-02T00:00:00.000Z",
        next_bill_date: "2026-10-02T00:00:00.000Z",
        canceled_at: null,
      },
      "2026-09-02T17:53:43.000Z"
    );
    assert.equal(fields["Plan ID"], "12345");
    assert.deepEqual(fields["Status"], { name: "active" });
    assert.equal(fields["Amount"], 165);
    assert.equal(fields["Start Date"], "2026-09-02");
    assert.equal(fields["Canceled At"], null);
  });
  it("defaults a missing/non-numeric amount to 0 rather than NaN", () => {
    const fields = buildRecurringPlanFields({ id: 1 }, "now");
    assert.equal(fields["Amount"], 0);
  });
});

describe("shouldAssignCoversMember", () => {
  it("assigns when there is a member and nothing is assigned yet", () => {
    assert.equal(shouldAssignCoversMember(true, false), true);
  });
  it("never overwrites an existing gift assignment", () => {
    assert.equal(shouldAssignCoversMember(true, true), false);
  });
  it("does nothing without a resolved member id", () => {
    assert.equal(shouldAssignCoversMember(false, false), false);
  });
});
