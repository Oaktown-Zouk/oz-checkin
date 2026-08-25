import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { getStudentTimeline } from "./studentTimeline.js";

const STUDENT = "recStudent1";
const OTHER = "recOther";
const PROGRAM = "recProgram1";

describe("getStudentTimeline", () => {
  it("returns null for an unknown student", async () => {
    resetMockStore({});
    assert.equal(await getStudentTimeline("recNope"), null);
  });

  it("synthesizes one event per record, newest first, scoped to just this student", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.programs]: [{ id: PROGRAM, fields: { "Program Name": "Zouk L1", Status: "Active" } }],
      [TABLES.recurringPlans]: [
        {
          id: "recPlan1",
          fields: { "Covers Member": [STUDENT], Status: "active", "Start Date": "2025-01-01", Frequency: "monthly" },
        },
        // Someone else's plan — must not leak into this student's timeline.
        { id: "recPlanOther", fields: { "Covers Member": [OTHER], Status: "active", "Start Date": "2025-01-01" } },
      ],
      [TABLES.transactions]: [
        { id: "recTxn1", fields: { Member: [STUDENT], Amount: 120, "Transacted At": "2025-02-01T00:00:00Z", "Is Recurring": true } },
        { id: "recTxnDropIn", fields: { Member: [STUDENT], Amount: 20, "Transacted At": "2025-03-01T00:00:00Z" } },
        // Refunded — must be excluded entirely.
        { id: "recTxnRefunded", fields: { Member: [STUDENT], Amount: 20, "Transacted At": "2025-03-15T00:00:00Z", Refunded: true } },
      ],
      [TABLES.credits]: [{ id: "recCredit1", fields: { Member: [STUDENT], Reason: "New Member", "Granted At": "2025-01-01T00:00:00Z" } }],
      [TABLES.checkins]: [
        { id: "recCheckin1", fields: { Member: [STUDENT], "Checked In At": "2025-04-01T18:00:00Z", "Class Level": [PROGRAM], Role: "Lead" } },
        { id: "recCheckin2", fields: { Member: [STUDENT], "Checked In At": "2025-04-08T18:00:00Z", "Class Level": [PROGRAM], Role: "Follow" } },
      ],
    });

    const timeline = await getStudentTimeline(STUDENT);
    assert.equal(timeline?.totalCheckIns, 2);
    assert.equal(timeline?.mostRecentCheckInAt, "2025-04-08T18:00:00Z");

    // Newest first. Note membership_started's "at" is a bare date ("2025-01-01")
    // while credit_granted's is a full ISO timestamp on the same day
    // ("2025-01-01T00:00:00Z") — string comparison puts the longer one after the
    // shorter prefix, so credit_granted sorts ahead of membership_started here.
    const types = timeline?.events.map((e) => e.type);
    assert.deepEqual(types, ["checkin", "checkin", "payment", "payment", "credit_granted", "membership_started"]);

    // Refunded transaction excluded entirely — only 2 payment events, not 3.
    assert.equal(timeline?.events.filter((e) => e.type === "payment").length, 2);

    // Membership payment vs one-time pass labeled distinctly.
    const payments = timeline?.events.filter((e) => e.type === "payment").map((e) => e.label);
    assert.ok(payments?.some((l) => l.startsWith("Membership payment")));
    assert.ok(payments?.some((l) => l.startsWith("One-time pass purchased")));

    // Check-in label includes program name and role.
    const checkinEvent = timeline?.events.find((e) => e.type === "checkin" && e.at === "2025-04-08T18:00:00Z");
    assert.equal(checkinEvent?.label, "Checked in (Zouk L1, Follow)");
  });

  it("adds a membership_status event only when the plan's status isn't active", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.recurringPlans]: [
        {
          id: "recPlanCanceled",
          fields: {
            "Covers Member": [STUDENT],
            Status: "canceled",
            "Start Date": "2025-01-01",
            "Canceled At": "2025-06-01T00:00:00Z",
          },
        },
      ],
    });

    const timeline = await getStudentTimeline(STUDENT);
    const statusEvent = timeline?.events.find((e) => e.type === "membership_status");
    assert.equal(statusEvent?.label, "Membership canceled");
    assert.equal(statusEvent?.at, "2025-06-01T00:00:00Z");
  });

  it("doesn't add a membership_status event for an active plan", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.recurringPlans]: [{ id: "recPlanActive", fields: { "Covers Member": [STUDENT], Status: "active", "Start Date": "2025-01-01" } }],
    });

    const timeline = await getStudentTimeline(STUDENT);
    assert.equal(timeline?.events.some((e) => e.type === "membership_status"), false);
  });

  it("includes a levelup event with the issuer's name when From is present", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.levelups]: [
        {
          id: "recLevelup1",
          createdTime: "2025-05-01T00:00:00Z",
          fields: { Member: [STUDENT], Role: "Lead", From: 2, To: 3, "Issuer Name": ["Jane"] },
        },
      ],
    });

    const timeline = await getStudentTimeline(STUDENT);
    const levelupEvent = timeline?.events.find((e) => e.type === "levelup");
    assert.equal(levelupEvent?.label, "Assessed into Level 3 as a Lead by Jane");
    assert.equal(levelupEvent?.at, "2025-05-01T00:00:00Z");
  });

  it("uses a different label when the level goes down", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.levelups]: [
        { id: "recLevelup1", fields: { Member: [STUDENT], Role: "Follow", From: 3, To: 2, "Issuer Name": ["Jane"] } },
      ],
    });

    const timeline = await getStudentTimeline(STUDENT);
    const levelupEvent = timeline?.events.find((e) => e.type === "levelup");
    assert.equal(levelupEvent?.label, "Changed to Level 2 as a Follow by Jane");
  });

  it("uses a 'cleared' label when the level was reset back to unset", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.levelups]: [{ id: "recLevelup1", fields: { Member: [STUDENT], Role: "Lead", From: 3, "Issuer Name": ["Jane"] } }],
    });

    const timeline = await getStudentTimeline(STUDENT);
    const levelupEvent = timeline?.events.find((e) => e.type === "levelup");
    assert.equal(levelupEvent?.label, "Level cleared as a Lead by Jane");
  });

  it("omits the issuer attribution when Issuer Name is missing", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.levelups]: [{ id: "recLevelup1", fields: { Member: [STUDENT], Role: "Lead", From: 2, To: 3 } }],
    });

    const timeline = await getStudentTimeline(STUDENT);
    const levelupEvent = timeline?.events.find((e) => e.type === "levelup");
    assert.equal(levelupEvent?.label, "Assessed into Level 3 as a Lead");
  });

  it("hides a levelup event when From is missing (a student's first level in that role)", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.levelups]: [{ id: "recLevelup1", fields: { Member: [STUDENT], Role: "Lead", To: 1 } }],
    });

    const timeline = await getStudentTimeline(STUDENT);
    assert.equal(timeline?.events.some((e) => e.type === "levelup"), false);
  });

  it("excludes another student's levelups", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.levelups]: [{ id: "recLevelupOther", fields: { Member: [OTHER], Role: "Lead", From: 1, To: 2 } }],
    });

    const timeline = await getStudentTimeline(STUDENT);
    assert.deepEqual(timeline?.events, []);
  });

  it("includes a note event with full details, scoped to just this student", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.notes]: [
        {
          id: "recNote1",
          createdTime: "2025-06-01T00:00:00Z",
          fields: {
            Member: [STUDENT],
            Summary: "Great progress this week",
            Strengths: "Strong frame",
            Opportunities: "Timing on turns",
            "Issuer Name": ["Jane"],
          },
        },
        // Someone else's note — must not leak into this student's timeline.
        { id: "recNoteOther", fields: { Member: [OTHER], Summary: "Not this student", "Issuer Name": ["Jane"] } },
      ],
    });

    const timeline = await getStudentTimeline(STUDENT);
    const noteEvent = timeline?.events.find((e) => e.type === "note");
    assert.equal(noteEvent?.label, "Note from Jane: Great progress this week");
    assert.equal(noteEvent?.at, "2025-06-01T00:00:00Z");
    assert.deepEqual(noteEvent?.note, {
      summary: "Great progress this week",
      strengths: "Strong frame",
      opportunities: "Timing on turns",
      issuerName: "Jane",
    });
    assert.equal(timeline?.events.filter((e) => e.type === "note").length, 1);
  });

  it("reports zero check-ins and a null mostRecentCheckInAt when there are none", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: STUDENT, fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
    });
    const timeline = await getStudentTimeline(STUDENT);
    assert.equal(timeline?.totalCheckIns, 0);
    assert.equal(timeline?.mostRecentCheckInAt, null);
    assert.deepEqual(timeline?.events, []);
  });
});
