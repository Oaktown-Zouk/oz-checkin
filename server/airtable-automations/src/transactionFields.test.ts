import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNightlyTransactionFields, buildWebhookTransactionFields } from "./transactionFields.js";

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

describe("buildNightlyTransactionFields", () => {
  it("does not include Plan ID / Is Recurring / Refunded fields", () => {
    const fields = buildNightlyTransactionFields(basePayload, "now");
    assert.equal("Plan ID" in fields, false);
    assert.equal("Is Recurring" in fields, false);
    assert.equal("Refunded" in fields, false);
  });
  it("maps amounts and status correctly", () => {
    const fields = buildNightlyTransactionFields(basePayload, "now");
    assert.equal(fields["Amount"], 25);
    assert.equal(fields["Fee"], 1.2);
    assert.deepEqual(fields["Status"], { name: "succeeded" });
  });
});

describe("buildWebhookTransactionFields", () => {
  it("marks a transaction with a plan_id as recurring even without an explicit is_recurring flag", () => {
    const fields = buildWebhookTransactionFields({ ...basePayload, plan_id: 12345 }, "now");
    assert.equal(fields["Is Recurring"], true);
    assert.equal(fields["Plan ID"], "12345");
  });
  it("treats a refunded_at timestamp as refunded even without an explicit refunded flag", () => {
    const fields = buildWebhookTransactionFields({ ...basePayload, refunded_at: "2026-09-03T00:00:00.000Z" }, "now");
    assert.equal(fields["Refunded"], true);
    assert.equal(fields["Refunded At"], "2026-09-03");
  });
  it("defaults refunded amount to 0 when absent", () => {
    const fields = buildWebhookTransactionFields(basePayload, "now");
    assert.equal(fields["Refunded Amount"], 0);
  });
  it("is not recurring or refunded for a plain drop-in payload", () => {
    const fields = buildWebhookTransactionFields(basePayload, "now");
    assert.equal(fields["Is Recurring"], false);
    assert.equal(fields["Refunded"], false);
  });
});
