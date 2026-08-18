import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
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
import { listStudentStatuses, getStudentStatusById, updateStudentLevel } from "./studentStatus.js";
import { NotFoundError } from "../lib/errors.js";

before(setupTestDb);
beforeEach(resetDb);

describe("membership active-window logic", () => {
  it("active status with no period-end is active", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "active", currentPeriodEnd: null });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.active, true);
  });

  it("active status with a future period-end is active", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.active, true);
  });

  it("active status with a past period-end is NOT active", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() - 86_400_000),
    });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.active, false);
    assert.equal(status?.membership?.status, "active", "raw status is still surfaced for display");
  });

  it("a cancelled status is not active regardless of period-end", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, {
      status: "cancelled",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.active, false);
  });
});

describe("membership.lastPaymentAt — history for judging a paused membership", () => {
  it("is null when the membership has no charge history", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.lastPaymentAt, null);
  });

  it("is the most recent charge against that membership's plan", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });
    await insertMembershipCharge(id, "plan-1", { paidAt: new Date("2026-07-03") });
    await insertMembershipCharge(id, "plan-1", { paidAt: new Date("2026-08-03") });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.lastPaymentAt, new Date("2026-08-03").toISOString());
  });

  it("ignores charges billed against a different plan", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });
    await insertMembershipCharge(id, "plan-other", { paidAt: new Date("2026-08-03") });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.lastPaymentAt, null);
  });

  it("is also surfaced for an active membership, not just paused", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "active", planId: "plan-1" });
    await insertMembershipCharge(id, "plan-1", { paidAt: new Date("2026-08-03") });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.lastPaymentAt, new Date("2026-08-03").toISOString());
  });
});

describe("membership.coversCheckIn — grace period for a recently-paid paused membership", () => {
  it("an active membership always covers, with or without payment history", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "active", planId: "plan-1" });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.coversCheckIn, true);
  });

  it("a paused membership paid within the last 30 days covers", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });
    await insertMembershipCharge(id, "plan-1", { paidAt: new Date(Date.now() - 10 * 86_400_000) });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.coversCheckIn, true);
  });

  it("a paused membership paid more than 30 days ago does NOT cover", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });
    await insertMembershipCharge(id, "plan-1", { paidAt: new Date(Date.now() - 31 * 86_400_000) });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.coversCheckIn, false);
  });

  it("a paused membership with no payment history at all does NOT cover", async () => {
    const id = await insertStudent("a@example.com");
    await insertMembership(id, { status: "paused", planId: "plan-1" });

    const status = await getStudentStatusById(id);
    assert.equal(status?.membership?.coversCheckIn, false);
  });
});

describe("credits computation", () => {
  it("counts available vs. total correctly across a mix of redeemed/unredeemed", async () => {
    const id = await insertStudent("a@example.com");
    await insertPayment(id, { redeemed: true });
    await insertPayment(id, { redeemed: false });
    await insertPayment(id, { redeemed: false });

    const status = await getStudentStatusById(id);
    assert.equal(status?.credits?.total, 3);
    assert.equal(status?.credits?.available, 2);
  });

  it("a student with no payments at all has null credits, not zero", async () => {
    const id = await insertStudent("a@example.com");

    const status = await getStudentStatusById(id);
    assert.equal(status?.credits, null);
  });

  it("folds a promo credit (e.g. the new-student freebie) into available/total alongside real payments", async () => {
    const id = await insertStudent("a@example.com");
    await insertPayment(id, { redeemed: true });
    await insertPromoCredit(id);

    const status = await getStudentStatusById(id);
    assert.equal(status?.credits?.total, 2);
    assert.equal(status?.credits?.available, 1, "the unredeemed promo credit counts as available");
  });

  it("credits is non-null when a student has only a promo credit and no real payments", async () => {
    const id = await insertStudent("a@example.com");
    await insertPromoCredit(id);

    const status = await getStudentStatusById(id);
    assert.equal(status?.credits?.available, 1);
    assert.equal(status?.credits?.promo.length, 1);
    assert.equal(status?.credits?.promo[0].reason, "new_student");
  });

  it("a redeemed promo credit does not count as available", async () => {
    const id = await insertStudent("a@example.com");
    await insertPromoCredit(id, { redeemed: true });

    const status = await getStudentStatusById(id);
    assert.equal(status?.credits?.available, 0);
    assert.equal(status?.credits?.total, 1);
    assert.equal(status?.credits?.promo[0].redeemed, true);
  });
});

describe("listStudentStatuses — search", () => {
  it("filters by name substring, case-insensitively", async () => {
    await insertStudent("a@example.com", "Alecia Lentz");
    await insertStudent("b@example.com", "Ben Brooks");

    const results = await listStudentStatuses({ query: "alecia" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Alecia Lentz");
  });

  it("returns everyone when the query is empty", async () => {
    await insertStudent("a@example.com");
    await insertStudent("b@example.com");

    const results = await listStudentStatuses({ query: "" });
    assert.equal(results.length, 2);
  });
});

describe("listStudentStatuses — sort order", () => {
  it("not-checked-in students sort alphabetically ahead of checked-in ones", async () => {
    await insertStudent("zoe@example.com", "Zoe");
    await insertStudent("alex@example.com", "Alex");
    const mia = await insertStudent("mia@example.com", "Mia");
    await insertCheckin(mia);

    const results = await listStudentStatuses();
    assert.deepEqual(
      results.map((s) => s.name),
      ["Alex", "Zoe", "Mia"]
    );
    assert.equal(results[2].checkedInToday, true);
  });

  it("checked-in students sink in earliest-check-in-first order", async () => {
    const first = await insertStudent("first@example.com", "First");
    const second = await insertStudent("second@example.com", "Second");
    await insertCheckin(second, { checkedInAt: new Date("2026-08-09T10:00:00Z") });
    await insertCheckin(first, { checkedInAt: new Date("2026-08-09T10:05:00Z") });

    const results = await listStudentStatuses();
    const checkedIn = results.filter((s) => s.checkedInToday);
    assert.deepEqual(
      checkedIn.map((s) => s.name),
      ["Second", "First"]
    );
  });
});

describe("getStudentStatusById", () => {
  it("returns null for an unknown id", async () => {
    const status = await getStudentStatusById(999_999);
    assert.equal(status, null);
  });

  it("accepts a date to view/act on a day other than today", async () => {
    const id = await insertStudent("a@example.com");
    const pastDate = "2026-08-01";
    await insertCheckin(id, { date: pastDate });

    const pastStatus = await getStudentStatusById(id, pastDate);
    assert.equal(pastStatus?.checkedInToday, true);

    const liveStatus = await getStudentStatusById(id);
    assert.equal(liveStatus?.checkedInToday, false);
  });
});

describe("listStudentStatuses — date param", () => {
  it("scopes the checked-in bucket and sort to the given date, not real today", async () => {
    const checkedOnPastDay = await insertStudent("p@example.com", "Past Day Person");
    await insertStudent("q@example.com", "Nobody");
    await insertCheckin(checkedOnPastDay, { date: "2026-08-01" });

    const pastView = await listStudentStatuses({ date: "2026-08-01" });
    const pastStatus = pastView.find((s) => s.id === checkedOnPastDay);
    assert.equal(pastStatus?.checkedInToday, true);
    // sorted to the bottom on that day's view
    assert.equal(pastView[pastView.length - 1].id, checkedOnPastDay);

    const liveView = await listStudentStatuses();
    const liveStatus = liveView.find((s) => s.id === checkedOnPastDay);
    assert.equal(liveStatus?.checkedInToday, false);
  });
});

describe("everCheckedIn — New Student promo eligibility", () => {
  it("is false for a student with no check-in history at all", async () => {
    const id = await insertStudent("a@example.com");

    const status = await getStudentStatusById(id);
    assert.equal(status?.everCheckedIn, false);
  });

  it("is true once they have any real check-in, even on a date other than the one being viewed", async () => {
    const id = await insertStudent("a@example.com");
    await insertCheckin(id, { date: "2026-08-01" });

    // Viewing today (they have no check-in today specifically) still reports
    // everCheckedIn: true — this is a lifetime signal, not scoped to the viewed date.
    const todayView = await getStudentStatusById(id);
    assert.equal(todayView?.checkedInToday, false);
    assert.equal(todayView?.everCheckedIn, true);

    const pastView = await getStudentStatusById(id, "2026-08-01");
    assert.equal(pastView?.everCheckedIn, true);
  });

  it("is false again if their only check-in was undone", async () => {
    const id = await insertStudent("a@example.com");
    await insertCheckin(id, { date: "2026-08-01", undoneAt: new Date("2026-08-01T10:00:00") });

    const status = await getStudentStatusById(id);
    assert.equal(status?.everCheckedIn, false, "an undone visit shouldn't burn the promo");
  });
});

describe("dance level (leadLevel/followLevel)", () => {
  it("is null for both by default", async () => {
    const id = await insertStudent("a@example.com");

    const status = await getStudentStatusById(id);
    assert.equal(status?.leadLevel, null);
    assert.equal(status?.followLevel, null);
  });

  it("sets the lead level independently of the follow level", async () => {
    const id = await insertStudent("a@example.com");

    await updateStudentLevel(id, "leadLevel", 3);

    const status = await getStudentStatusById(id);
    assert.equal(status?.leadLevel, 3);
    assert.equal(status?.followLevel, null);
  });

  it("sets the follow level independently of the lead level", async () => {
    const id = await insertStudent("a@example.com");

    await updateStudentLevel(id, "followLevel", 2);

    const status = await getStudentStatusById(id);
    assert.equal(status?.leadLevel, null);
    assert.equal(status?.followLevel, 2);
  });

  it("can unset a level by passing null", async () => {
    const id = await insertStudent("a@example.com");
    await updateStudentLevel(id, "leadLevel", 4);

    await updateStudentLevel(id, "leadLevel", null);

    const status = await getStudentStatusById(id);
    assert.equal(status?.leadLevel, null);
  });

  it("throws NotFoundError for an unknown student", async () => {
    await assert.rejects(() => updateStudentLevel(999_999, "leadLevel", 2), NotFoundError);
  });
});

describe("holder/payer split — transferred memberships and credits", () => {
  it("heldMemberships lists ALL held memberships, not just the primary one (e.g. a second membership bought for someone else)", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    await insertMembership(alice, { planId: "plan-own", status: "active" });
    await insertMembership(alice, { planId: "plan-gift", status: "active" });

    const status = await getStudentStatusById(alice);
    assert.equal(status?.heldMemberships.length, 2);
  });

  it("a transferred membership shows up on the holder's status, not the payer's", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertMembership(alice, { planId: "plan-1", holderStudentId: bob });

    const bobStatus = await getStudentStatusById(bob);
    assert.equal(bobStatus?.membership?.status, "active");

    const aliceStatus = await getStudentStatusById(alice);
    assert.equal(aliceStatus?.membership, null, "Alice no longer holds it");
  });

  it("the holder's membership shows managedByName when the payer differs", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertMembership(alice, { planId: "plan-1", holderStudentId: bob });

    const bobStatus = await getStudentStatusById(bob);
    assert.equal(bobStatus?.membership?.managedByName, "Alice");
  });

  it("managedByName is null when the holder and payer are the same (no transfer)", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    await insertMembership(alice, { planId: "plan-1" });

    const status = await getStudentStatusById(alice);
    assert.equal(status?.membership?.managedByName, null);
  });

  it("a transferred credit shows up on the holder's credits, with purchasedByName set", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertPayment(alice, { holderStudentId: bob, amountCents: 2000 });

    const bobStatus = await getStudentStatusById(bob);
    assert.equal(bobStatus?.credits?.available, 1);
    assert.equal(bobStatus?.credits?.payments[0].purchasedByName, "Alice");

    const aliceStatus = await getStudentStatusById(alice);
    assert.equal(aliceStatus?.credits, null, "Alice no longer holds the credit");
  });

  it("a membership's charge history follows its transferred holder for lastPaymentAt", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertMembership(alice, { planId: "plan-1", status: "paused", holderStudentId: bob });
    const paidAt = new Date("2026-08-01T00:00:00Z");
    await insertMembershipCharge(alice, "plan-1", { paidAt, holderStudentId: bob });

    const bobStatus = await getStudentStatusById(bob);
    assert.equal(bobStatus?.membership?.lastPaymentAt, paidAt.toISOString());
  });

  it("paidMembershipsForOthers surfaces on the payer's status when they paid but don't hold it", async () => {
    const alice = await insertStudent("alice@example.com", "Alice");
    const bob = await insertStudent("bob@example.com", "Bob");
    await insertMembership(alice, { planId: "plan-1", holderStudentId: bob });
    const paidAt = new Date("2026-08-01T00:00:00Z");
    await insertMembershipCharge(alice, "plan-1", { holderStudentId: bob, amountCents: 16500, paidAt });

    const aliceStatus = await getStudentStatusById(alice);
    assert.equal(aliceStatus?.paidMembershipsForOthers.length, 1);
    assert.equal(aliceStatus?.paidMembershipsForOthers[0].studentName, "Bob");
    assert.equal(aliceStatus?.paidMembershipsForOthers[0].amountCents, 16500);
    assert.equal(aliceStatus?.paidMembershipsForOthers[0].paidAt, paidAt.toISOString());

    const bobStatus = await getStudentStatusById(bob);
    assert.equal(bobStatus?.paidMembershipsForOthers.length, 0, "Bob is the holder, not a payer-for-others");
  });
});
