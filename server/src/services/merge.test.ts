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
  CompCreditFields,
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

  it("reassigns check-ins, recurring plans (both link fields), transactions, comp credits, levelups, and notes", async () => {
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
      [TABLES.compCredits]: [{ id: "recComp1", fields: { Member: [DUPLICATE], Amount: 1 } }],
      [TABLES.levelups]: [{ id: "recLevelup1", fields: { Member: [DUPLICATE], Role: "Lead", To: 2 } }],
      [TABLES.notes]: [{ id: "recNote1", fields: { Member: [DUPLICATE], Summary: "test" } }],
    });

    await mergeMembers(SURVIVOR, DUPLICATE);

    const [checkins, plans, transactions, compCredits, levelups, notes] = await Promise.all([
      listRecords<CheckinFields>(TABLES.checkins),
      listRecords<RecurringPlanFields>(TABLES.recurringPlans),
      listRecords<TransactionFields>(TABLES.transactions),
      listRecords<CompCreditFields>(TABLES.compCredits),
      listRecords<LevelupFields>(TABLES.levelups),
      listRecords<NoteFields>(TABLES.notes),
    ]);
    assert.deepEqual(checkins[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(plans[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(plans[0].fields["Covers Member"], [SURVIVOR]);
    assert.deepEqual(transactions[0].fields.Member, [SURVIVOR]);
    assert.deepEqual(compCredits[0].fields.Member, [SURVIVOR]);
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

  describe("gap-filling", () => {
    it("copies Phone, Lead Level, Follow Level, Contact ID, and New Member Credit onto the survivor when it's missing them", async () => {
      seedMembers(
        {},
        {
          Phone: "555-1234",
          "Lead Level": 2,
          "Follow Level": 3,
          "Contact ID": "gb-contact-1",
          "New Member Credit": 1,
        }
      );

      const updated = await mergeMembers(SURVIVOR, DUPLICATE);
      assert.equal(updated.leadLevel, 2);
      assert.equal(updated.followLevel, 3);
      assert.equal(updated.contactId, "gb-contact-1");

      const survivor = await getRecordOrNull<MemberFields>(TABLES.members, SURVIVOR);
      assert.equal(survivor?.fields.Phone, "555-1234");
      assert.equal(survivor?.fields["New Member Credit"], 1);
    });

    it("never overwrites a value the survivor already has, including New Member Credit", async () => {
      seedMembers(
        { Phone: "555-0000", "Lead Level": 1, "Contact ID": "gb-contact-survivor", "New Member Credit": 1 },
        { Phone: "555-1234", "Lead Level": 2, "Contact ID": "gb-contact-duplicate", "New Member Credit": 1 }
      );

      const updated = await mergeMembers(SURVIVOR, DUPLICATE);
      assert.equal(updated.leadLevel, 1);
      assert.equal(updated.contactId, "gb-contact-survivor");

      const survivor = await getRecordOrNull<MemberFields>(TABLES.members, SURVIVOR);
      assert.equal(survivor?.fields.Phone, "555-0000");
      // Both sides had their own New Member Credit (the double-Member-row race
      // scenario) — survivor keeps its own 1 rather than summing to 2. The
      // duplicate's is simply dropped when the duplicate is hidden, never
      // reassigned or added, since it isn't a rollup.
      assert.equal(survivor?.fields["New Member Credit"], 1);
    });
  });
});
