import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTransactionFields, notaflofCreditsRequested, recurringPlanLinkField } from "./transactionFields.js";

const basePayload = {
  id: 999,
  amount: 25,
  fee: 1.2,
  donated: 23.8,
  status: "succeeded",
  payment_method: "card",
  campaign: { title: "Drop-in" },
  transacted_at: "2026-09-02T17:53:43.000Z",
};

describe("buildTransactionFields", () => {
  it("maps amounts and status correctly", () => {
    const fields = buildTransactionFields(basePayload, "now");
    assert.equal(fields["Amount"], 25);
    assert.equal(fields["Fee"], 1.2);
    assert.deepEqual(fields["Status"], { name: "succeeded" });
  });
  it("marks a transaction with a plan_id as recurring even without an explicit is_recurring flag", () => {
    const fields = buildTransactionFields({ ...basePayload, plan_id: 12345 }, "now");
    assert.equal(fields["Is Recurring"], true);
    assert.equal(fields["Plan ID"], "12345");
  });
  it("reads refunded/refunded_at off the nested transactions[0] entry, not the top level", () => {
    const fields = buildTransactionFields(
      { ...basePayload, transactions: [{ refunded: true, refunded_at: "2026-09-03T00:00:00.000Z" }] },
      "now"
    );
    assert.equal(fields["Refunded"], true);
    assert.equal(fields["Refunded At"], "2026-09-03");
  });
  it("treats a nested refunded_at timestamp as refunded even without an explicit refunded flag", () => {
    const fields = buildTransactionFields(
      { ...basePayload, transactions: [{ refunded_at: "2026-09-03T00:00:00.000Z" }] },
      "now"
    );
    assert.equal(fields["Refunded"], true);
  });
  it("ignores a top-level refunded/refunded_at -- Givebutter never actually puts them there", () => {
    const fields = buildTransactionFields(
      { ...basePayload, refunded: true, refunded_at: "2026-09-03T00:00:00.000Z" } as Record<string, unknown>,
      "now"
    );
    assert.equal(fields["Refunded"], false);
    assert.equal(fields["Refunded At"], null);
  });
  it("never writes Refunded Amount -- Givebutter doesn't report it, and a staffer's manual entry shouldn't get stomped to 0", () => {
    const fields = buildTransactionFields(basePayload, "now");
    assert.equal("Refunded Amount" in fields, false);
  });
  it("is not recurring or refunded for a plain drop-in payload", () => {
    const fields = buildTransactionFields(basePayload, "now");
    assert.equal(fields["Is Recurring"], false);
    assert.equal(fields["Refunded"], false);
  });
  it("fills in NOTAFLOF Credits Requeested from the matching custom field on a NOTAFLOF drop-in transaction", () => {
    const fields = buildTransactionFields(
      {
        ...basePayload,
        campaign: undefined,
        campaign_code: "ZROVNN",
        custom_fields: [{ title: "How many classes are you paying for?", value: "2" }],
      },
      "now"
    );
    assert.equal(fields["Campaign"], "ZROVNN");
    assert.equal(fields["NOTAFLOF Credits Requeested"], 2);
  });
  it("leaves NOTAFLOF Credits Requeested null for a non-NOTAFLOF transaction, even with a matching custom field", () => {
    const fields = buildTransactionFields(
      { ...basePayload, custom_fields: [{ title: "How many classes are you paying for?", value: "2" }] },
      "now"
    );
    assert.equal(fields["NOTAFLOF Credits Requeested"], null);
  });
});

describe("notaflofCreditsRequested", () => {
  it("returns null for any campaign other than the NOTAFLOF drop-ins one, regardless of custom fields", () => {
    const transaction = { custom_fields: [{ title: "How many classes are you paying for?", value: "2" }] };
    assert.equal(notaflofCreditsRequested(transaction, "Drop-in"), null);
    // The separate NOTAFLOF membership campaign doesn't ask this question either.
    assert.equal(notaflofCreditsRequested(transaction, "NOTAFLOF Membership"), null);
  });
  it("matches the question case-insensitively and ignores surrounding whitespace", () => {
    const transaction = { custom_fields: [{ title: "  HOW MANY CLASSES ARE YOU PAYING FOR?  ", value: "1" }] };
    assert.equal(notaflofCreditsRequested(transaction, "ZROVNN"), 1);
  });
  it("pulls digits out of a non-numeric answer like '2 classes'", () => {
    const transaction = { custom_fields: [{ title: "How many classes are you paying for?", value: "2 classes" }] };
    assert.equal(notaflofCreditsRequested(transaction, "ZROVNN"), 2);
  });
  it("returns null when no custom field matches the question", () => {
    const transaction = { custom_fields: [{ title: "Shirt size", value: "M" }] };
    assert.equal(notaflofCreditsRequested(transaction, "ZROVNN"), null);
  });
  it("returns null for an unparseable or zero answer", () => {
    assert.equal(
      notaflofCreditsRequested({ custom_fields: [{ title: "How many classes are you paying for?", value: "none" }] }, "ZROVNN"),
      null
    );
    assert.equal(
      notaflofCreditsRequested({ custom_fields: [{ title: "How many classes are you paying for?", value: "0" }] }, "ZROVNN"),
      null
    );
  });
  it("returns null for a missing or non-array custom_fields list", () => {
    assert.equal(notaflofCreditsRequested({}, "ZROVNN"), null);
  });
});

describe("recurringPlanLinkField", () => {
  it("links to the matching Recurring Plans record id", () => {
    const map = new Map([["12345", "recPlanA"]]);
    assert.deepEqual(recurringPlanLinkField("12345", map), { "Recurring Plans": [{ id: "recPlanA" }] });
  });
  it("returns null for a blank Plan ID -- a one-time drop-in has nothing to link", () => {
    const map = new Map([["12345", "recPlanA"]]);
    assert.equal(recurringPlanLinkField("", map), null);
  });
  it("returns null (not an empty link) when the plan hasn't been synced yet", () => {
    const map = new Map<string, string>();
    assert.equal(recurringPlanLinkField("12345", map), null);
  });
});
