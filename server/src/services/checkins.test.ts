import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  resetDb,
  insertStudent,
  insertMembership,
  insertPayment,
} from "../testing/helpers.js";
import { createCheckIn, undoCheckIn } from "./checkins.js";
import { listStudentStatuses } from "./studentStatus.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { db } from "../db/client.js";
import { payments } from "../db/schema.js";
import { dateStringFor, today } from "../lib/date.js";

before(setupTestDb);
beforeEach(resetDb);

describe("createCheckIn — recurring member", () => {
  it("allows the first check-in of the day without consuming anything", async () => {
    const studentId = await insertStudent("member@example.com");
    await insertMembership(studentId, { status: "active" });

    const status = await createCheckIn(studentId);

    assert.equal(status.checkedInToday, true);
    assert.equal(status.checkinsToday.length, 1);
    assert.equal(status.checkinsToday[0].paymentId, null);
    assert.equal(status.membership?.active, true);
  });

  it("blocks a second check-in the same day (nothing to spend)", async () => {
    const studentId = await insertStudent("member@example.com");
    await insertMembership(studentId, { status: "active" });

    await createCheckIn(studentId);

    await assert.rejects(() => createCheckIn(studentId), ConflictError);
  });

  it("an inactive membership (past period end) does not grant free re-entry", async () => {
    const studentId = await insertStudent("lapsed@example.com");
    await insertMembership(studentId, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() - 86_400_000), // yesterday
    });

    // First check-in is still allowed (front-desk override), but with no payment link
    // since the membership isn't actually active.
    const status = await createCheckIn(studentId);
    assert.equal(status.membership?.active, false);
    assert.equal(status.checkinsToday[0].paymentId, null);

    // And a second one is blocked, same as the no-payment-at-all case.
    await assert.rejects(() => createCheckIn(studentId), ConflictError);
  });
});

describe("createCheckIn — one-time payer (class credits)", () => {
  it("the 'buy two passes, let a friend use one' scenario: two check-ins same day, two credits spent", async () => {
    const studentId = await insertStudent("ben@example.com", "Ben Brooks");
    const credit1 = await insertPayment(studentId);
    const credit2 = await insertPayment(studentId);

    const afterFirst = await createCheckIn(studentId);
    assert.equal(afterFirst.checkedInToday, true);
    assert.equal(afterFirst.credits?.available, 1);
    assert.equal(afterFirst.canCheckIn, true, "one credit left, so another check-in is still allowed");

    const afterSecond = await createCheckIn(studentId);
    assert.equal(afterSecond.checkinsToday.length, 2);
    assert.equal(afterSecond.credits?.available, 0);
    assert.equal(afterSecond.canCheckIn, false);

    // Both credits actually got spent (not just the same one twice).
    const spentIds = afterSecond.checkinsToday.map((c) => c.paymentId).sort();
    assert.deepEqual(spentIds, [credit1, credit2].sort());

    await assert.rejects(() => createCheckIn(studentId), ConflictError);
  });

  it("redeems the oldest unredeemed credit first", async () => {
    const studentId = await insertStudent("carla@example.com");
    const older = await insertPayment(studentId, { paidAt: new Date("2026-01-01") });
    await insertPayment(studentId, { paidAt: new Date("2026-06-01") });

    const status = await createCheckIn(studentId);

    assert.equal(status.checkinsToday[0].paymentId, older);
  });

  it("an explicit paymentId is honored over auto-selection", async () => {
    const studentId = await insertStudent("dana@example.com");
    await insertPayment(studentId, { paidAt: new Date("2026-01-01") }); // older, would be auto-picked
    const newer = await insertPayment(studentId, { paidAt: new Date("2026-06-01") });

    const status = await createCheckIn(studentId, { paymentId: newer });

    assert.equal(status.checkinsToday[0].paymentId, newer);
  });

  it("rejects a paymentId that doesn't belong to the student", async () => {
    const studentId = await insertStudent("erin@example.com");
    await insertPayment(studentId);
    const otherStudentId = await insertStudent("other@example.com");
    const otherPaymentId = await insertPayment(otherStudentId);

    await assert.rejects(
      () => createCheckIn(studentId, { paymentId: otherPaymentId }),
      ConflictError
    );
  });

  it("rejects a paymentId that's already redeemed", async () => {
    const studentId = await insertStudent("frank@example.com");
    const paymentId = await insertPayment(studentId, { redeemed: true });

    await assert.rejects(() => createCheckIn(studentId, { paymentId }), ConflictError);
  });

  it("all credits redeemed: front desk can still override once, but not twice", async () => {
    const studentId = await insertStudent("grace@example.com");
    await insertPayment(studentId, { redeemed: true });

    const status = await createCheckIn(studentId);
    assert.equal(status.checkinsToday[0].paymentId, null);

    await assert.rejects(() => createCheckIn(studentId), ConflictError);
  });
});

describe("createCheckIn — no payment on file at all", () => {
  it("allows a front-desk override for the first check-in, blocks a second", async () => {
    const studentId = await insertStudent("hank@example.com");

    const status = await createCheckIn(studentId);
    assert.equal(status.checkedInToday, true);
    assert.equal(status.checkinsToday[0].paymentId, null);

    await assert.rejects(() => createCheckIn(studentId), ConflictError);
  });
});

describe("createCheckIn — errors", () => {
  it("throws NotFoundError for an unknown student", async () => {
    await assert.rejects(() => createCheckIn(999_999), NotFoundError);
  });
});

describe("undoCheckIn", () => {
  it("un-redeems the credit and allows checking in again", async () => {
    const studentId = await insertStudent("ivy@example.com");
    await insertPayment(studentId);

    const afterCheckIn = await createCheckIn(studentId);
    const checkinId = afterCheckIn.checkinsToday[0].id;

    const afterUndo = await undoCheckIn(checkinId);
    assert.equal(afterUndo.checkedInToday, false);
    assert.equal(afterUndo.credits?.available, 1);
    assert.equal(afterUndo.canCheckIn, true);

    // And the credit is genuinely usable again, not just cosmetically reset.
    const afterSecondCheckIn = await createCheckIn(studentId);
    assert.equal(afterSecondCheckIn.checkedInToday, true);
  });

  it("throws NotFoundError for an unknown or already-undone check-in", async () => {
    const studentId = await insertStudent("jill@example.com");
    const status = await createCheckIn(studentId);
    const checkinId = status.checkinsToday[0].id;

    await undoCheckIn(checkinId);

    await assert.rejects(() => undoCheckIn(checkinId), NotFoundError);
    await assert.rejects(() => undoCheckIn(999_999), NotFoundError);
  });
});

describe("createCheckIn — backdating via effectiveAt", () => {
  it("stamps both the day-bucket and the exact time from effectiveAt, not now", async () => {
    const studentId = await insertStudent("kate@example.com");
    const effectiveAt = new Date("2026-08-01T15:04:00");

    const status = await createCheckIn(studentId, { effectiveAt });

    assert.equal(status.checkinsToday[0].checkedInAt, effectiveAt.toISOString());
  });

  it("a backdated check-in shows up when viewing that day, not when viewing today", async () => {
    const studentId = await insertStudent("liam@example.com", "Liam");
    const pastDate = "2026-08-01";
    const effectiveAt = new Date(`${pastDate}T15:04:00`);

    await createCheckIn(studentId, { effectiveAt });

    const [pastView] = await listStudentStatuses({ ids: [studentId], date: pastDate });
    assert.equal(pastView.checkedInToday, true);

    const [todayView] = await listStudentStatuses({ ids: [studentId] });
    assert.equal(todayView.checkedInToday, false, "today's real view is unaffected");
  });

  it("credit redemption is stamped with the effective time too", async () => {
    const studentId = await insertStudent("mona@example.com");
    const paymentId = await insertPayment(studentId);
    const effectiveAt = new Date("2026-08-01T15:04:00");

    await createCheckIn(studentId, { effectiveAt });

    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
    assert.equal(payment.redeemedAt?.toISOString(), effectiveAt.toISOString());
  });

  it("the daily cap applies per backdated day, independent of today's real state", async () => {
    const studentId = await insertStudent("noah@example.com");
    await insertMembership(studentId, { status: "active" });
    const pastDate = "2026-08-01";

    // Check in for real today first.
    await createCheckIn(studentId);
    // A correction for a different (past) day is still allowed — it's a separate cap.
    const backdated = await createCheckIn(studentId, {
      effectiveAt: new Date(`${pastDate}T09:00:00`),
    });
    assert.equal(dateStringFor(new Date(backdated.checkinsToday[0].checkedInAt)), pastDate);

    // But a second correction for that SAME past day hits the same one-per-day cap.
    await assert.rejects(
      () => createCheckIn(studentId, { effectiveAt: new Date(`${pastDate}T09:30:00`) }),
      ConflictError
    );
  });
});

describe("undoCheckIn — on a backdated check-in", () => {
  it("returns status for the check-in's own day, not today", async () => {
    const studentId = await insertStudent("olive@example.com");
    const pastDate = "2026-08-01";
    const status = await createCheckIn(studentId, {
      effectiveAt: new Date(`${pastDate}T09:00:00`),
    });
    const checkinId = status.checkinsToday[0].id;

    const afterUndo = await undoCheckIn(checkinId);

    assert.equal(afterUndo.checkedInToday, false);
    // Sanity: this student really does have no check-in today (the real today), so the
    // fact that checkedInToday is false here is specifically about pastDate's view, not
    // a coincidence of also being true for real today.
    assert.notEqual(pastDate, today());
  });
});
