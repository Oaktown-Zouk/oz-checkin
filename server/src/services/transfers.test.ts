import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { transferMembership, heldMemberships } from "./transfers.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";

const SOURCE = "recSource";
const TARGET = "recTarget";
const PLAN = "recPlan1";

function seed() {
  resetMockStore({
    [TABLES.members]: [
      { id: SOURCE, fields: { "Full Name": "Source Student", Email: "source@example.com", "Classes Allowed": 1 } },
      { id: TARGET, fields: { "Full Name": "Target Student", Email: "target@example.com", "Classes Allowed": 1 } },
    ],
    [TABLES.recurringPlans]: [
      {
        id: PLAN,
        fields: { "Plan ID": "plan-1", Status: "active", Frequency: "monthly", Amount: 120, "Covers Member": [SOURCE] },
      },
    ],
  });
}

describe("transferMembership", () => {
  it("moves Covers Member to the target and returns the source's updated status", async () => {
    seed();
    await transferMembership(SOURCE, PLAN, "target@example.com");

    const remaining = await heldMemberships(SOURCE);
    assert.deepEqual(remaining, []);
    const targetHeld = await heldMemberships(TARGET);
    assert.equal(targetHeld.length, 1);
    assert.equal(targetHeld[0].id, PLAN);
  });

  it("matches the target email case-insensitively", async () => {
    seed();
    const updated = await transferMembership(SOURCE, PLAN, "Target@EXAMPLE.com");
    assert.equal(updated.id, SOURCE);
    assert.equal((await heldMemberships(TARGET)).length, 1);
  });

  it("throws NotFoundError if no member has that email", async () => {
    seed();
    await assert.rejects(() => transferMembership(SOURCE, PLAN, "nobody@example.com"), NotFoundError);
  });

  it("throws ConflictError if the target email is the source student's own", async () => {
    seed();
    await assert.rejects(() => transferMembership(SOURCE, PLAN, "source@example.com"), ConflictError);
  });

  it("throws NotFoundError for an unknown plan id", async () => {
    seed();
    await assert.rejects(() => transferMembership(SOURCE, "recDoesNotExist", "target@example.com"), NotFoundError);
  });

  it("throws ConflictError if the plan doesn't currently belong to the source student", async () => {
    seed();
    // Someone else's plan — sourceStudentId here isn't its Covers Member.
    await assert.rejects(() => transferMembership(TARGET, PLAN, "source@example.com"), ConflictError);
  });

  it("throws ConflictError if the plan was already transferred (stale client state)", async () => {
    seed();
    await transferMembership(SOURCE, PLAN, "target@example.com");
    // Retrying the same transfer against now-stale state should reject, not silently
    // re-apply — the plan's Covers Member is TARGET now, not SOURCE.
    await assert.rejects(() => transferMembership(SOURCE, PLAN, "target@example.com"), ConflictError);
  });
});

describe("heldMemberships", () => {
  it("returns only plans this student currently holds, with the expected shape", async () => {
    seed();
    const held = await heldMemberships(SOURCE);
    assert.deepEqual(held, [{ id: PLAN, status: "active", frequency: "monthly", amount: 120 }]);
  });

  it("returns an empty list for a student holding nothing", async () => {
    seed();
    assert.deepEqual(await heldMemberships(TARGET), []);
  });
});
