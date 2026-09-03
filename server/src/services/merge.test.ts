import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords, getRecordOrNull } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type {
  MemberFields,
  CheckinFields,
  RecurringPlanFields,
  TransactionFields,
  CreditFields,
  LevelupFields,
  NoteFields,
} from "../airtable/fields.js";
import { mergeMembers } from "./merge.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";

const SURVIVOR = "recSurvivor";
const DUPLICATE = "recDuplicate";

function seedMembers(survivorFields: MemberFields = {}, duplicateFields: MemberFields = {}) {
  resetMockStore({
    [TABLES.members]: [
      { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com", ...survivorFields } },
      { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com", ...duplicateFields } },
    ],
  });
}

describe("mergeMembers", () => {
  it("throws ConflictError when survivorId and duplicateId are the same", async () => {
    seedMembers();
    await assert.rejects(() => mergeMembers(SURVIVOR, SURVIVOR), ConflictError);
  });

  it("throws NotFoundError for an unknown survivor or duplicate id", async () => {
    seedMembers();
    await assert.rejects(() => mergeMembers("recNope", DUPLICATE), NotFoundError);
    await assert.rejects(() => mergeMembers(SURVIVOR, "recNope"), NotFoundError);
  });

  it("reassigns check-ins, recurring plans (both link fields), transactions, levelups, and notes", async () => {
    resetMockStore({
      [TABLES.members]: [
        { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
        { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
      ],
      [TABLES.checkins]: [{ id: "recCheckin1", fields: { Member: [DUPLICATE] } }],
      [TABLES.recurringPlans]: [
        // The duplicate is both payer and holder of the same plan here — Member and
        // Covers Member must both move.
        { id: "recPlan1", fields: { Member: [DUPLICATE], "Covers Member": [DUPLICATE] } },
      ],
      [TABLES.transactions]: [{ id: "recTxn1", fields: { Member: [DUPLICATE] } }],
      [TABLES.levelups]: [{ id: "recLevelup1", fields: { Member: [DUPLICATE], Role: "Lead", To: 2 } }],
      [TABLES.notes]: [{ id: "recNote1", fields: { Member: [DUPLICATE], Summary: "test" } }],
    });

    await mergeMembers(SURVIVOR, DUPLICATE);

    const [checkins, plans, transactions, levelups, notes] = await Promise.all([
      listRecords<CheckinFields>(TABLES.checkins),
      listRecords<RecurringPlanFields>(TABLES.recurringPlans),
      listRecords<TransactionFields>(TABLES.transactions),
      listRecords<LevelupFields>(TABLES.levelups),
      listRecords<NoteFields>(TABLES.notes),
    ]);
    assert.deepEqual(checkins[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(plans[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(plans[0].fields["Covers Member"], [SURVIVOR]);
    assert.deepEqual(transactions[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(levelups[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(notes[0].fields.Member, [SURVIVOR]);
  });

  it("flags the duplicate as Duplicate and returns the survivor's updated status", async () => {
    seedMembers();
    const updated = await mergeMembers(SURVIVOR, DUPLICATE);
    assert.equal(updated.id, SURVIVOR);

    const duplicate = await getRecordOrNull<MemberFields>(TABLES.members, DUPLICATE);
    assert.equal(duplicate?.fields.Duplicate, true);
  });

  describe("credits", () => {
    it("deletes the duplicate's New Member credit (not just leaves it orphaned) when the survivor already has one", async () => {
      resetMockStore({
        [TABLES.members]: [
          { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
          { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
        ],
        [TABLES.credits]: [
          { id: "recCreditSurvivor", fields: { Member: [SURVIVOR], Reason: "New Member", "Granted At": "2026-01-01" } },
          { id: "recCreditDuplicate", fields: { Member: [DUPLICATE], Reason: "New Member", "Granted At": "2026-02-01" } },
        ],
      });

      await mergeMembers(SURVIVOR, DUPLICATE);

      const credits = await listRecords<CreditFields>(TABLES.credits);
      assert.equal(credits.length, 1);
      assert.equal(credits[0].id, "recCreditSurvivor");
      assert.deepEqual(credits[0].fields.Member, [SURVIVOR]);
    });

    it("collapses two New Member credits on the duplicate alone down to the earliest one, deleting the rest", async () => {
      resetMockStore({
        [TABLES.members]: [
          { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
          { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
        ],
        [TABLES.credits]: [
          { id: "recCreditLater", fields: { Member: [DUPLICATE], Reason: "New Member", "Granted At": "2026-02-01" } },
          { id: "recCreditEarlier", fields: { Member: [DUPLICATE], Reason: "New Member", "Granted At": "2026-01-01" } },
        ],
      });

      await mergeMembers(SURVIVOR, DUPLICATE);

      const credits = await listRecords<CreditFields>(TABLES.credits);
      assert.equal(credits.length, 1);
      assert.equal(credits[0].id, "recCreditEarlier");
      assert.deepEqual(credits[0].fields.Member, [SURVIVOR]);
    });

    it("prefers an already-used New Member credit over an untouched one, wherever each currently sits", async () => {
      resetMockStore({
        [TABLES.members]: [
          { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
          { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
        ],
        [TABLES.checkins]: [{ id: "recCheckinUsedIt", fields: { Member: [DUPLICATE] } }],
        [TABLES.credits]: [
          { id: "recCreditUnused", fields: { Member: [SURVIVOR], Reason: "New Member", "Granted At": "2026-01-01" } },
          {
            id: "recCreditUsed",
            fields: {
              Member: [DUPLICATE],
              Reason: "New Member",
              "Granted At": "2026-02-01",
              "Consumed By Check-in": ["recCheckinUsedIt"],
            },
          },
        ],
      });

      await mergeMembers(SURVIVOR, DUPLICATE);

      const credits = await listRecords<CreditFields>(TABLES.credits);
      assert.equal(credits.length, 1);
      assert.equal(credits[0].id, "recCreditUsed");
      assert.deepEqual(credits[0].fields.Member, [SURVIVOR]);
    });

    it("leaves both credits alone and flags their check-ins for review when two New Member credits are each already used", async () => {
      resetMockStore({
        [TABLES.members]: [
          { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
          { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
        ],
        [TABLES.checkins]: [
          { id: "recCheckinA", fields: { Member: [SURVIVOR] } },
          { id: "recCheckinB", fields: { Member: [DUPLICATE] } },
        ],
        [TABLES.credits]: [
          {
            id: "recCreditA",
            fields: { Member: [SURVIVOR], Reason: "New Member", "Consumed By Check-in": ["recCheckinA"] },
          },
          {
            id: "recCreditB",
            fields: { Member: [DUPLICATE], Reason: "New Member", "Consumed By Check-in": ["recCheckinB"] },
          },
        ],
      });

      await mergeMembers(SURVIVOR, DUPLICATE);

      const credits = await listRecords<CreditFields>(TABLES.credits);
      assert.equal(credits.length, 2, "neither used credit should be deleted");

      const checkins = await listRecords<CheckinFields>(TABLES.checkins);
      for (const checkin of checkins) {
        assert.equal(checkin.fields["Needs Review"], true);
        assert.match(checkin.fields["Review Reason"] ?? "", /New Member/);
      }
    });

    it("reassigns the duplicate's New Member credit when the survivor doesn't have one", async () => {
      resetMockStore({
        [TABLES.members]: [
          { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
          { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
        ],
        [TABLES.credits]: [{ id: "recCreditDuplicate", fields: { Member: [DUPLICATE], Reason: "New Member" } }],
      });

      await mergeMembers(SURVIVOR, DUPLICATE);

      const credits = await listRecords<CreditFields>(TABLES.credits);
      assert.deepEqual(credits[0].fields.Member, [SURVIVOR]);
    });

    it("always reassigns non-New-Member credits, and Purchased By independently of Member", async () => {
      resetMockStore({
        [TABLES.members]: [
          { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com" } },
          { id: DUPLICATE, fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com" } },
        ],
        [TABLES.credits]: [
          { id: "recCreditSurvivor", fields: { Member: [SURVIVOR], Reason: "New Member" } },
          {
            id: "recCreditDropIn",
            fields: { Member: [DUPLICATE], "Purchased By": [DUPLICATE], Reason: "Drop-in Purchase" },
          },
        ],
      });

      await mergeMembers(SURVIVOR, DUPLICATE);

      const credits = await listRecords<CreditFields>(TABLES.credits);
      const dropIn = credits.find((c) => c.id === "recCreditDropIn");
      assert.deepEqual(dropIn?.fields.Member, [SURVIVOR]);
      assert.deepEqual(dropIn?.fields["Purchased By"], [SURVIVOR]);
    });
  });

  describe("gap-filling", () => {
    it("copies Phone, Lead Level, Follow Level, and Contact ID onto the survivor when it's missing them", async () => {
      seedMembers(
        {},
        { Phone: "555-1234", "Lead Level": 2, "Follow Level": 3, "Contact ID": "gb-contact-1" }
      );

      const updated = await mergeMembers(SURVIVOR, DUPLICATE);
      assert.equal(updated.leadLevel, 2);
      assert.equal(updated.followLevel, 3);
      assert.equal(updated.contactId, "gb-contact-1");

      const survivor = await getRecordOrNull<MemberFields>(TABLES.members, SURVIVOR);
      assert.equal(survivor?.fields.Phone, "555-1234");
    });

    it("never overwrites a value the survivor already has", async () => {
      seedMembers(
        { Phone: "555-0000", "Lead Level": 1, "Contact ID": "gb-contact-survivor" },
        { Phone: "555-1234", "Lead Level": 2, "Contact ID": "gb-contact-duplicate" }
      );

      const updated = await mergeMembers(SURVIVOR, DUPLICATE);
      assert.equal(updated.leadLevel, 1);
      assert.equal(updated.contactId, "gb-contact-survivor");

      const survivor = await getRecordOrNull<MemberFields>(TABLES.members, SURVIVOR);
      assert.equal(survivor?.fields.Phone, "555-0000");
    });
  });
});
