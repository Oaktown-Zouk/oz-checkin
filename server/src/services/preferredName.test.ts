import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { MemberFields } from "../airtable/fields.js";
import { updatePreferredName } from "./preferredName.js";
import { NotFoundError } from "../lib/errors.js";

describe("updatePreferredName", () => {
  function seedMember() {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Jonathan Smith", "Classes Allowed": 1 } }],
    });
  }

  it("sets the Preferred Name field and reflects it on the returned status", async () => {
    seedMember();
    const updated = await updatePreferredName("recMember1", "Johnny");

    const [member] = await listRecords<MemberFields>(TABLES.members);
    assert.equal(member.fields["Preferred Name"], "Johnny");
    assert.equal(updated.preferredName, "Johnny");
  });

  it("clears the field when given an empty string", async () => {
    seedMember();
    await updatePreferredName("recMember1", "Johnny");
    const updated = await updatePreferredName("recMember1", "");

    const [member] = await listRecords<MemberFields>(TABLES.members);
    assert.equal(member.fields["Preferred Name"], "");
    assert.equal(updated.preferredName, "");
  });

  it("throws NotFoundError for an unknown student", async () => {
    resetMockStore({});
    await assert.rejects(() => updatePreferredName("recNope", "Johnny"), NotFoundError);
  });
});
