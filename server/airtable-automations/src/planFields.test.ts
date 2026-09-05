import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRecurringPlanFields, shouldAssignCoversMember, tierRuleForAmount, tierRuleLinkFields } from "./planFields.js";

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

describe("tierRuleForAmount", () => {
  const tiers = [
    { id: "rec2", name: "2 classes", min: 150 },
    { id: "rec1", name: "1 class", min: 90 },
  ];
  it("picks the richest tier the amount clears", () => {
    assert.equal(tierRuleForAmount(tiers, 165)?.id, "rec2");
    assert.equal(tierRuleForAmount(tiers, 95)?.id, "rec1");
  });
  it("returns null for a zero or negative amount", () => {
    assert.equal(tierRuleForAmount(tiers, 0), null);
    assert.equal(tierRuleForAmount(tiers, -10), null);
  });
  it("returns null when nothing matches", () => {
    assert.equal(tierRuleForAmount(tiers, 10), null);
  });
});

describe("tierRuleLinkFields", () => {
  it("returns null when the current link already matches the desired tier", () => {
    assert.equal(tierRuleLinkFields({ id: "rec1", name: "1 class", min: 90 }, "rec1"), null);
  });
  it("returns null when no tier matches and the link is already empty", () => {
    assert.equal(tierRuleLinkFields(null, null), null);
  });
  it("returns a link patch when the desired tier differs from current", () => {
    assert.deepEqual(tierRuleLinkFields({ id: "rec2", name: "2 classes", min: 150 }, "rec1"), {
      "Tier Rule": [{ id: "rec2" }],
    });
  });
  it("returns an empty link patch when a member no longer matches any tier", () => {
    assert.deepEqual(tierRuleLinkFields(null, "rec1"), { "Tier Rule": [] });
  });
});
