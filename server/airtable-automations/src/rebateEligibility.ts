export interface RebateUpdate {
  markTransactionRebateEligible: boolean;
  markMemberRefundEligible: boolean;
}

// Decides what (if anything) to write once a Transactions record's own qualifying
// fields (Is Recurring, Status, Amount, Transacted At) are already in place and its
// own "Recurring Payment Key" formula has picked up the change. Reuses that field and
// Members."First Recurring Key" (both pre-existing Airtable formula/rollup fields --
// see docs/airtable-schema.md's "Rebates" section) rather than re-deriving "is this
// the member's first recurring payment" from scratch: First Recurring Key is already
// the MIN of every one of the member's qualifying transactions' keys, so this
// transaction IS the first iff its own key equals it.
//
// currentRebateStatus gates the Member write specifically: only ever transitions
// Rebate Status away from its untouched state (blank or "New") once -- a status
// that's already progressed further (Refund Requested, Refund Processed, ...) is
// left alone, matching Rebate Owed's own documented policy of never retroactively
// changing what someone was owed. The Transaction write has no such guard -- the
// same one row will always be the member's first, forever, so re-marking it "50%" on
// a later run is a harmless no-op, not a drift risk.
export function decideRebateUpdate(
  transactionRecurringPaymentKey: number | null,
  memberFirstRecurringKey: number | null,
  currentRebateStatus: string | null | undefined
): RebateUpdate {
  const isFirstPayment =
    transactionRecurringPaymentKey != null &&
    memberFirstRecurringKey != null &&
    transactionRecurringPaymentKey === memberFirstRecurringKey;

  if (!isFirstPayment) {
    return { markTransactionRebateEligible: false, markMemberRefundEligible: false };
  }

  const untouched = !currentRebateStatus || currentRebateStatus === "New";
  return { markTransactionRebateEligible: true, markMemberRefundEligible: untouched };
}
