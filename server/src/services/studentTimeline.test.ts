import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  resetDb,
  insertStudent,
  insertWaiver,
  insertMembership,
  insertMembershipCharge,
  insertPayment,
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
    await insertWaiver(id, { signedAt: new Date("2026-05-01T00:00:00Z") });
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

  it("firstRegisteredAt is null when the student has no waiver, payment, or membership", async () => {
    const id = await insertStudent("a@example.com");
    const timeline = await getStudentTimeline(id);
    assert.equal(timeline?.firstRegisteredAt, null);
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
