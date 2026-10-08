import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { getRecordOrNull } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { MemberFields } from "../airtable/fields.js";
import { markDuplicateOf } from "./merge.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";

const SURVIVOR = "recSurvivor";
const DUPLICATE = "recDuplicate";

function seedMembers(duplicateFields: MemberFields = {}, survivorFields: MemberFields = {}) {
  resetMockStore({
    [TABLES.members]: [
      { id: SURVIVOR, fields: { "Full Name": "Duplicate Dana", Email: "dana@example.com", ...survivorFields } },
      {
        id: DUPLICATE,
        fields: { "Full Name": "Duplicate Dana", Email: "Dana@Example.com", "Removed From Givebutter": true, ...duplicateFields },
      },
    ],
  });
}

describe("markDuplicateOf", () => {
  it("sets Duplicate Of on the merged-away record and nothing else", async () => {
    seedMembers();
    await markDuplicateOf(DUPLICATE, SURVIVOR);
    const duplicate = await getRecordOrNull<MemberFields>(TABLES.members, DUPLICATE);
    assert.deepEqual(duplicate?.fields["Duplicate Of"], [SURVIVOR]);
    assert.equal(duplicate?.fields.Duplicate, undefined);
  });

  it("throws ConflictError when both ids are the same", async () => {
    seedMembers();
    await assert.rejects(() => markDuplicateOf(DUPLICATE, DUPLICATE), ConflictError);
  });

  it("throws NotFoundError for an unknown id on either side", async () => {
    seedMembers();
    await assert.rejects(() => markDuplicateOf("recNope", SURVIVOR), NotFoundError);
    await assert.rejects(() => markDuplicateOf(DUPLICATE, "recNope"), NotFoundError);
  });

  it("requires the duplicate to be Removed From Givebutter", async () => {
    seedMembers({ "Removed From Givebutter": false });
    await assert.rejects(() => markDuplicateOf(DUPLICATE, SURVIVOR), ConflictError);
  });

  it("refuses a duplicate that's already marked", async () => {
    seedMembers({ "Duplicate Of": ["recSomeoneElse"] });
    await assert.rejects(() => markDuplicateOf(DUPLICATE, SURVIVOR), ConflictError);
  });

  it("refuses a survivor that is itself merged away", async () => {
    for (const survivorFields of [
      { Duplicate: true },
      { "Duplicate Of": ["recSomeoneElse"] },
      { "Removed From Givebutter": true },
    ] as MemberFields[]) {
      seedMembers({}, survivorFields);
      await assert.rejects(() => markDuplicateOf(DUPLICATE, SURVIVOR), ConflictError);
    }
  });
});
