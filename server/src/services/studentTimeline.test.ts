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
  insertPromoCredit,
  insertCheckin,
} from "../testing/helpers.js";
import { getStudentTimeline } from "./studentTimeline.js";
import { db } from "../db/client.js";
import { memberships } from "../db/schema.js";

before(setupTestDb);
beforeEach(resetDb);

describe("getStudentTimeline", () => {
  it("returns null for an unknown student", async () => {
    const timeline = await getStudentTimeline(999_999);
    assert.equal(timeline, null);
  });

  it("emits a membership_started event using startedAt when present", async () => {
    const id = await insertStudent("a@example.com");
    const startedAt = new Date("2026-01-15T10:00:00Z");
    await insertMembership(id, { status: "active", frequency: "monthly", startedAt });

    const timeline = await getStudentTimeline(id);
    const event = timeline?.events.find((e) => e.type === "membership_started");
    assert.equal(event?.at, startedAt.toISOString());
    assert.equal(event?.label, "Membership started (monthly)");
  });

  it("falls back to the row's createdAt when startedAt is unknown", async () => {
    const id = await insertStudent("a@example.com");
    const membershipId = await insertMembership(id, { status: "active" });
    const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));

    const timeline = await getStudentTimeline(id);
    const event = timeline?.events.find((e) => e.type === "membership_started");
    assert.equal(event?.at, row.createdAt.toISOString());
  });

  it("emits a membership_status event for any non-active status, using its real status word", async () => {
    const id = await insertStudent("a@example.com");
    const canceledAt = new Date("2026-02-01T00:00:00Z");
    await insertMembership(id, { status: "paused", canceledAt });

    const timeline = await getStudentTimeline(id);
    const event = timeline?.events.find((e) => e.type === "membership_status");
    assert.equal(event?.label, "Membership paused");
    assert.equal(event?.at, canceledAt.toISOString());
  });

  it("does not emit a membership_status event for an active membership", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "active" });

    const timeline = await getStudentTimeline(id);
    assert.equal(
      timeline?.events.some((e) => e.type === "membership_status"),
      false
    );
  });

  it("emits a payment event with the dollar amount formatted", async () => {
    const id = await insertStudent("a@example.com");
    const paidAt = new Date("2026-03-01T12:00:00Z");
    await insertPayment(id, { amountCents: 2500, paidAt });

    const timeline = await getStudentTimeline(id);
    const event = timeline?.events.find((e) => e.type === "payment");
    assert.equal(event?.label, "One-time pass purchased ($25.00)");
    assert.equal(event?.at, paidAt.toISOString());
  });

  it("emits a membership_payment event with the dollar amount formatted, distinct from a one-time payment", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });
    const paidAt = new Date("2026-08-03T00:00:00Z");
    await insertMembershipCharge(id, "plan-1", { amountCents: 16500, paidAt });

    const timeline = await getStudentTimeline(id);
    const event = timeline?.events.find((e) => e.type === "membership_payment");
    assert.equal(event?.label, "Membership payment ($165.00)");
    assert.equal(event?.at, paidAt.toISOString());
    assert.equal(
      timeline?.events.some((e) => e.type === "payment"),
      false,
      "a membership charge must not also show up as a one-time payment"
    );
  });

  it("emits a promo_credit event for the new-student free drop-in", async () => {
    const id = await insertStudent("a@example.com");
    const grantedAt = new Date("2026-08-01T00:00:00Z");
    await insertPromoCredit(id, { grantedAt });

    const timeline = await getStudentTimeline(id);
    const event = timeline?.events.find((e) => e.type === "promo_credit");
    assert.equal(event?.label, "Free drop-in credit granted");
    assert.equal(event?.at, grantedAt.toISOString());
  });

  it("emits a checkin event and excludes undone check-ins", async () => {
    const id = await insertStudent("a@example.com");
    const checkedInAt = new Date("2026-03-05T18:00:00Z");
    await insertCheckin(id, { checkedInAt });
    await insertCheckin(id, { checkedInAt: new Date("2026-01-01T00:00:00Z"), undoneAt: new Date() });

    const timeline = await getStudentTimeline(id);
    const checkinEvents = timeline?.events.filter((e) => e.type === "checkin");
    assert.equal(checkinEvents?.length, 1);
    assert.equal(checkinEvents?.[0].at, checkedInAt.toISOString());
    assert.equal(timeline?.totalCheckIns, 1);
  });

  it("sorts all events newest-first regardless of type", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "active", startedAt: new Date("2026-01-01T00:00:00Z") });
    await insertPayment(id, { paidAt: new Date("2026-03-01T00:00:00Z") });
    await insertCheckin(id, { checkedInAt: new Date("2026-02-01T00:00:00Z") });

    const timeline = await getStudentTimeline(id);
    const types = timeline?.events.map((e) => e.type);
    assert.deepEqual(types, ["payment", "checkin", "membership_started"]);
  });

  it("computes firstRegisteredAt as the earliest touchpoint across all sources", async () => {
    const id = await insertStudent("a@example.com");
    await insertPayment(id, { paidAt: new Date("2026-01-01T00:00:00Z") }); // earliest
    await insertMembership(id, { status: "active", startedAt: new Date("2026-03-01T00:00:00Z") });

    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.firstRegisteredAt, new Date("2026-01-01T00:00:00Z").toISOString());
  });

  it("firstRegisteredAt considers membership charges too", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1", startedAt: new Date("2026-05-01") });
    await insertMembershipCharge(id, "plan-1", { paidAt: new Date("2026-01-01T00:00:00Z") }); // earliest

    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.firstRegisteredAt, new Date("2026-01-01T00:00:00Z").toISOString());
  });

  it("firstRegisteredAt is null when the student has no payment or membership", async () => {
    const id = await insertStudent("a@example.com");
    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.firstRegisteredAt, null);
  });

  it("firstRegisteredAt ignores a promo credit's grantedAt (a sync-time stamp, not a real-world event)", async () => {
    const id = await insertStudent("a@example.com");
    // Granted "earlier" than the real payment — if it were considered, it would
    // incorrectly win as firstRegisteredAt.
    await insertPromoCredit(id, { grantedAt: new Date("2026-01-01T00:00:00Z") });
    await insertPayment(id, { paidAt: new Date("2026-05-01T00:00:00Z") });

    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.firstRegisteredAt, new Date("2026-05-01T00:00:00Z").toISOString());
  });

  it("computes mostRecentCheckInAt as the latest check-in, or null if none", async () => {
    const id = await insertStudent("a@example.com");
    await insertCheckin(id, { date: "2026-01-01", checkedInAt: new Date("2026-01-01T00:00:00Z") });
    await insertCheckin(id, { date: "2026-06-01", checkedInAt: new Date("2026-06-01T00:00:00Z") });

    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.mostRecentCheckInAt, new Date("2026-06-01T00:00:00Z").toISOString());

    const other = await insertStudent("b@example.com");
    const otherTimeline = await getStudentTimeline(other);
    assert.equal(otherTimeline?.mostRecentCheckInAt, null);
  });

  it("includes the computed status alongside the timeline", async () => {
    const id = await insertStudent("a@example.com", "Timeline Test");
    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.status.name, "Timeline Test");
  });
});

describe("getStudentTimeline — transferred memberships and credits", () => {
  it("labels a held membership payment with who actually paid, when different", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertMembership(alice, { planId: "plan-1", holderStudentId: bob });
    await insertMembershipCharge(alice, "plan-1", { holderStudentId: bob, amountCents: 16500 });

    const bobTimeline = await getStudentTimeline(bob);
    const event = bobTimeline?.events.find((e) => e.type === "membership_payment");
    assert.equal(event?.label, "Membership payment, paid by Alice ($165.00)");
  });

  it("emits membership_payment_for_other on the payer's timeline for a transferred membership", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertMembership(alice, { planId: "plan-1", holderStudentId: bob });
    const paidAt = new Date("2026-08-01T00:00:00Z");
    await insertMembershipCharge(alice, "plan-1", { holderStudentId: bob, amountCents: 16500, paidAt });

    const aliceTimeline = await getStudentTimeline(alice);
    const event = aliceTimeline?.events.find((e) => e.type === "membership_payment_for_other");
    assert.equal(event?.label, "Paid for Bob's membership ($165.00)");
    assert.equal(event?.at, paidAt.toISOString());

    // And Alice's own membership_payment history is empty — she doesn't hold this plan.
    assert.equal(
      aliceTimeline?.events.some((e) => e.type === "membership_payment"),
      false
    );
  });

  it("labels a transferred one-time credit with who purchased it", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertPayment(alice, { holderStudentId: bob, amountCents: 2000 });

    const bobTimeline = await getStudentTimeline(bob);
    const event = bobTimeline?.events.find((e) => e.type === "payment");
    assert.equal(event?.label, "One-time pass received from Alice ($20.00)");
  });
});
