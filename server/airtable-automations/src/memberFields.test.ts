import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildNewMemberFields,
  buildNewMemberFieldsWithLowercaseEmail,
  fillMemberFieldGaps,
  diffMemberFields,
  buildContactMemberFields,
} from "./memberFields.js";

describe("buildNewMemberFields", () => {
  it("does not lowercase email, matching the nightly Plans/Transactions scripts", () => {
    assert.deepEqual(buildNewMemberFields("Erica", "Edelman", "Erica.Edelman@Example.com", "555-1234"), {
      "First Name": "Erica",
      "Last Name": "Edelman",
      "Email": "Erica.Edelman@Example.com",
      "Phone": "555-1234",
    });
  });
});

describe("buildNewMemberFieldsWithLowercaseEmail", () => {
  it("lowercases email, matching the Contacts script and the webhook", () => {
    assert.equal(
      buildNewMemberFieldsWithLowercaseEmail("Erica", "Edelman", "Erica.Edelman@Example.com", "555-1234")["Email"],
      "erica.edelman@example.com"
    );
  });
});

describe("fillMemberFieldGaps", () => {
  it("fills a blank field from an incoming value", () => {
    assert.deepEqual(fillMemberFieldGaps({ first: "Erica" }, { first: "" }), { "First Name": "Erica" });
  });
  it("never overwrites a field that already has a value -- the hand-corrected-name guarantee", () => {
    assert.deepEqual(fillMemberFieldGaps({ first: "Erika" }, { first: "Erica" }), {});
  });
  it("only considers keys present in `incoming` -- omitting phone means phone is never touched", () => {
    const changed = fillMemberFieldGaps({ first: "Erica", last: "Edelman" }, { first: "", last: "", phone: "" } as any);
    assert.deepEqual(changed, { "First Name": "Erica", "Last Name": "Edelman" });
    assert.equal("Phone" in changed, false);
  });
  it("skips a falsy incoming value even when current is blank", () => {
    assert.deepEqual(fillMemberFieldGaps({ first: "" }, { first: "" }), {});
  });
});

describe("diffMemberFields", () => {
  it("writes a field only when the incoming value differs from current", () => {
    assert.deepEqual(diffMemberFields({ first: "Erica" }, { first: "Erika" }), { "First Name": "Erica" });
  });
  it("writes nothing when incoming matches current -- avoids churning last-modified", () => {
    assert.deepEqual(diffMemberFields({ first: "Erica" }, { first: "Erica" }), {});
  });
  it("skips a falsy incoming value even if current differs", () => {
    assert.deepEqual(diffMemberFields({ first: "" }, { first: "Erica" }), {});
  });
});

describe("buildContactMemberFields", () => {
  it("maps a full Givebutter contact payload to Airtable field names", () => {
    const fields = buildContactMemberFields(
      {
        id: 44573119,
        first_name: "Erica",
        last_name: "Edelman",
        primary_email: "Erica@Example.com",
        primary_phone: "555-1234",
        tags: ["vip"],
        is_email_subscribed: "true",
        contact_since: "2026-08-21T16:31:05.000Z",
        stats: { total_contributions: 165 },
        primary_address: { city: "Oakland", state: "CA" },
        note: "met at a social",
        archived_at: null,
      },
      "2026-09-02T17:53:43.000Z"
    );
    assert.equal(fields["Contact ID"], "44573119");
    assert.equal(fields["Email"], "erica@example.com");
    assert.equal(fields["Tags"], "vip");
    assert.equal(fields["Email Subscribed"], true);
    assert.equal(fields["Contact Since"], "2026-08-21");
    assert.equal(fields["Givebutter Total Given"], 165);
    assert.equal(fields["Address"], "Oakland, CA");
    assert.equal(fields["Archived in Givebutter"], false);
    assert.equal(fields["Contact Synced At"], "2026-09-02T17:53:43.000Z");
  });
  it("falls back to the first emails[]/phones[] entry when primary_* is absent", () => {
    const fields = buildContactMemberFields(
      { id: 1, emails: [{ value: "a@example.com" }], phones: [{ value: "555-0000" }] },
      "now"
    );
    assert.equal(fields["Email"], "a@example.com");
    assert.equal(fields["Phone"], "555-0000");
  });
});
