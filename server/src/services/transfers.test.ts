import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  resetDb,
  insertStudent,
  insertMembership,
  insertMembershipCharge,
  insertPayment,
} from "../testing/helpers.js";
import { transferItem } from "./transfers.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { db } from "../db/client.js";
import { memberships, membershipCharges, payments } from "../db/schema.js";

before(setupTestDb);
beforeEach(resetDb);

describe("transferItem — membership", () => {
  it("moves holderStudentId but leaves studentId (the real payer) untouched", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    const membershipId = await insertMembership(alice, { planId: "plan-1" });

    await transferItem(alice, "membership", membershipId, "bob@example.com");

    const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
    assert.equal(row.holderStudentId, bob, "Bob now holds it");
    assert.equal(row.studentId, alice, "Alice is still recorded as the real Givebutter payer");
  });

  it("immediately re-points existing membership charge history to the new holder", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    const membershipId = await insertMembership(alice, { planId: "plan-1" });
    const chargeId = await insertMembershipCharge(alice, "plan-1");

    await transferItem(alice, "membership", membershipId, "bob@example.com");

    const [charge] = await db.select().from(membershipCharges).where(eq(membershipCharges.id, chargeId));
    assert.equal(charge.holderStudentId, bob);
    assert.equal(charge.studentId, alice, "the charge still shows Alice as who actually paid");
  });

  it("only re-points charges for the SAME plan, not other memberships", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    const transferredMembershipId = await insertMembership(alice, { planId: "plan-1" });
    await insertMembership(alice, { planId: "plan-2" });
    const otherChargeId = await insertMembershipCharge(alice, "plan-2");

    await transferItem(alice, "membership", transferredMembershipId, "bob@example.com");

    const [otherCharge] = await db
      .select()
      .from(membershipCharges)
      .where(eq(membershipCharges.id, otherChargeId));
    assert.equal(otherCharge.holderStudentId, alice, "unrelated plan's charge is untouched");
  });

  it("throws ConflictError when the membership doesn't currently belong to the source student", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    const carol = await insertStudent("carol@example.com", "Carol");
    const membershipId = await insertMembership(bob, { planId: "plan-1" });

    await assert.rejects(
      () => transferItem(alice, "membership", membershipId, "carol@example.com"),
      ConflictError
    );
  });

  it("throws ConflictError when transferring to the current holder", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const membershipId = await insertMembership(alice, { planId: "plan-1" });

    await assert.rejects(
      () => transferItem(alice, "membership", membershipId, "alice@example.com"),
      ConflictError
    );
  });

  it("throws NotFoundError for an unknown membership id", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    await insertStudent("bob@example.com", "Bob");

    await assert.rejects(
      () => transferItem(alice, "membership", 999_999, "bob@example.com"),
      NotFoundError
    );
  });

  it("throws NotFoundError when the target email doesn't match any student", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const membershipId = await insertMembership(alice, { planId: "plan-1" });

    await assert.rejects(
      () => transferItem(alice, "membership", membershipId, "nobody@example.com"),
      NotFoundError
    );
  });
});

describe("transferItem — payment (single-use credit)", () => {
  it("moves holderStudentId, leaves studentId (the real payer) untouched", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    const paymentId = await insertPayment(alice);

    await transferItem(alice, "payment", paymentId, "bob@example.com");

    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId));
    assert.equal(row.holderStudentId, bob);
    assert.equal(row.studentId, alice);
  });

  it("rejects transferring an already-redeemed credit", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    await insertStudent("bob@example.com", "Bob");
    const paymentId = await insertPayment(alice, { redeemed: true });

    await assert.rejects(
      () => transferItem(alice, "payment", paymentId, "bob@example.com"),
      ConflictError
    );
  });

  it("throws ConflictError when the credit doesn't currently belong to the source student", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertStudent("carol@example.com", "Carol");
    const paymentId = await insertPayment(bob);

    await assert.rejects(
      () => transferItem(alice, "payment", paymentId, "carol@example.com"),
      ConflictError
    );
  });
});
