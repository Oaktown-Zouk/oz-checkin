import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  setupTestDb,
  resetDb,
  insertStudent,
  insertWaiver,
  insertMembership,
  insertPayment,
  insertStudentEmail,
  insertCheckin,
} from "../testing/helpers.js";
import { listStudentStatuses, getStudentStatusById } from "./studentStatus.js";

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
});

describe("waiver", () => {
  it("picks the most recently signed waiver when multiple exist", async () => {
    const id = await insertStudent("a@example.com");
    await insertWaiver(id, { signedAt: new Date("2026-01-01"), formResponseId: "r1" });
    await insertWaiver(id, { signedAt: new Date("2026-06-01"), formResponseId: "r2" });

    const status = await getStudentStatusById(id);
    assert.equal(status?.waiver.signedAt, new Date("2026-06-01").toISOString());
  });
});

describe("alternateEmails", () => {
  it("includes emails linked via student_emails", async () => {
    const id = await insertStudent("primary@example.com");
    await insertStudentEmail(id, "alt1@example.com");
    await insertStudentEmail(id, "alt2@example.com");

    const status = await getStudentStatusById(id);
    assert.deepEqual(status?.alternateEmails.sort(), ["alt1@example.com", "alt2@example.com"]);
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
