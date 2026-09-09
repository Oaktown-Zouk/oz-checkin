import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideRebateUpdate } from "./rebateEligibility.js";

describe("decideRebateUpdate", () => {
  it("marks both when the transaction's key matches the member's first, status untouched (blank)", () => {
    assert.deepEqual(decideRebateUpdate(2410009500, 2410009500, null), {
      markTransactionRebateEligible: true,
      markMemberRefundEligible: true,
    });
  });

  it("marks both when the status is explicitly \"New\"", () => {
    assert.deepEqual(decideRebateUpdate(2410009500, 2410009500, "New"), {
      markTransactionRebateEligible: true,
      markMemberRefundEligible: true,
    });
  });

  it("marks only the transaction when the member's status already progressed past New", () => {
    for (const status of ["Refund Eligible", "Refund Method Email Sent", "Refund Requested", "Refund Processed", "Not Eligible"]) {
      assert.deepEqual(decideRebateUpdate(2410009500, 2410009500, status), {
        markTransactionRebateEligible: true,
        markMemberRefundEligible: false,
      });
    }
  });

  it("marks neither when the transaction's key doesn't match the member's first", () => {
    assert.deepEqual(decideRebateUpdate(2410009500, 2433001000, null), {
      markTransactionRebateEligible: false,
      markMemberRefundEligible: false,
    });
  });

  it("marks neither when the transaction has no Recurring Payment Key (not a qualifying recurring payment)", () => {
    assert.deepEqual(decideRebateUpdate(null, 2410009500, null), {
      markTransactionRebateEligible: false,
      markMemberRefundEligible: false,
    });
  });

  it("marks neither when the member has no First Recurring Key at all", () => {
    assert.deepEqual(decideRebateUpdate(2410009500, null, null), {
      markTransactionRebateEligible: false,
      markMemberRefundEligible: false,
    });
  });
});
