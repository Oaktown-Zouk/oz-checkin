import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contactEmails,
  indexContactIdsByEmail,
  splitVanishedMembers,
  survivorMemberId,
  type MergeCheckMember,
} from "./mergeDetection.js";

function member(overrides: Partial<MergeCheckMember>): MergeCheckMember {
  return { id: "recA", contactId: "1", email: "", removedFromGivebutter: false, hasDuplicateOf: false, ...overrides };
}

describe("contactEmails", () => {
  it("collects primary and secondary emails, lowercased and de-duplicated", () => {
    assert.deepEqual(
      contactEmails({ primary_email: "A@x.com", emails: [{ value: "a@x.com" }, { value: "b@x.com" }] }),
      ["a@x.com", "b@x.com"]
    );
  });
  it("skips blank and missing values", () => {
    assert.deepEqual(contactEmails({ primary_email: null, emails: [{ value: "" }, {}] }), []);
    assert.deepEqual(contactEmails({}), []);
  });
});

describe("indexContactIdsByEmail", () => {
  it("lists every contact carrying an email", () => {
    const index = indexContactIdsByEmail([
      { id: 1, primary_email: "a@x.com" },
      { id: 2, emails: [{ value: "A@x.com" }] },
      { id: 3, primary_email: "c@x.com" },
    ]);
    assert.deepEqual(index.get("a@x.com"), ["1", "2"]);
    assert.deepEqual(index.get("c@x.com"), ["3"]);
  });
  it("skips contacts with no id", () => {
    assert.equal(indexContactIdsByEmail([{ primary_email: "a@x.com" }]).size, 0);
  });
});

describe("splitVanishedMembers", () => {
  const live = new Set(["1", "2"]);
  it("flags members whose contact is gone and not yet flagged", () => {
    const { newlyVanished } = splitVanishedMembers(
      [member({ id: "recLive", contactId: "1" }), member({ id: "recGone", contactId: "9" })],
      live
    );
    assert.deepEqual(newlyVanished.map((m) => m.id), ["recGone"]);
  });
  it("leaves already-flagged and hand-made (blank Contact ID) members alone", () => {
    const { newlyVanished } = splitVanishedMembers(
      [member({ contactId: "9", removedFromGivebutter: true }), member({ contactId: "" })],
      live
    );
    assert.deepEqual(newlyVanished, []);
  });
  it("un-flags a member whose contact is live again, unless Duplicate Of is set", () => {
    const { reappeared } = splitVanishedMembers(
      [
        member({ id: "recBack", contactId: "1", removedFromGivebutter: true }),
        member({ id: "recResolved", contactId: "2", removedFromGivebutter: true, hasDuplicateOf: true }),
      ],
      live
    );
    assert.deepEqual(reappeared.map((m) => m.id), ["recBack"]);
  });
});

describe("survivorMemberId", () => {
  const memberIdByContactId = new Map([["10", "recSurvivor"], ["11", "recOther"], ["9", "recGone"]]);
  const vanished = member({ id: "recGone", contactId: "9", email: "Dup@x.com" });

  it("returns the member of the single live contact sharing the email (case-insensitive)", () => {
    const index = new Map([["dup@x.com", ["10"]]]);
    assert.equal(survivorMemberId(vanished, index, memberIdByContactId), "recSurvivor");
  });
  it("returns null when several live contacts share the email", () => {
    const index = new Map([["dup@x.com", ["10", "11"]]]);
    assert.equal(survivorMemberId(vanished, index, memberIdByContactId), null);
  });
  it("returns null with no email or no match", () => {
    assert.equal(survivorMemberId(member({ email: "" }), new Map(), memberIdByContactId), null);
    assert.equal(survivorMemberId(vanished, new Map(), memberIdByContactId), null);
  });
  it("returns null when the matching contact has no Member yet", () => {
    const index = new Map([["dup@x.com", ["99"]]]);
    assert.equal(survivorMemberId(vanished, index, memberIdByContactId), null);
  });
  it("never points a member at itself", () => {
    const index = new Map([["dup@x.com", ["9"]]]);
    assert.equal(survivorMemberId(vanished, index, memberIdByContactId), null);
  });
});
