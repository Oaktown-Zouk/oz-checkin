import { toText, toDateOnly, toSelectField, toBoolean } from "./text.js";

export interface GivebutterTransactionPayload {
  id?: unknown;
  amount?: unknown;
  fee?: unknown;
  donated?: unknown;
  status?: unknown;
  payment_method?: unknown;
  method?: unknown;
  campaign?: { title?: unknown };
  campaign_code?: unknown;
  transacted_at?: unknown;
  created_at?: unknown;
  plan_id?: unknown;
  is_recurring?: unknown;
  // Refunded/refunded_at live one level down in Givebutter's real API response,
  // on this nested sub-transaction -- never at the top level (confirmed against
  // live data: every transaction has exactly one entry here). refunded_amount
  // isn't reported anywhere in this object either way -- Givebutter only ever
  // exposes a refunded boolean + timestamp, never a dollar figure.
  transactions?: Array<{ refunded?: unknown; refunded_at?: unknown }>;
}

// One field set for both the nightly sync and the webhook -- the nightly sync used
// to write a narrower set (no Plan ID / Is Recurring / Refunded fields), which meant
// any transaction only ever nightly-synced was indistinguishable from a plain
// one-time drop-in even when it was really a recurring membership charge (Transactions
// is "disambiguated by Is Recurring + Plan ID presence" per docs/airtable-schema.md --
// a disambiguation that silently didn't work for most rows). Full parity closes that
// gap regardless of which sync path a given transaction happened to go through.
export function buildTransactionFields(transaction: GivebutterTransactionPayload, syncedAt: string): Record<string, unknown> {
  // Real API responses always carry exactly one entry here (confirmed against
  // live data) -- a transaction with no nested entry at all would mean
  // Givebutter changed this shape, not a genuine zero-payment transaction, so
  // falling back to an empty object (refunded/refunded_at both undefined,
  // same as "not refunded") is the safe default rather than throwing.
  const subTransaction = transaction.transactions?.[0] ?? {};
  return {
    "Transaction ID": String(transaction.id),
    "Amount": Number(transaction.amount) || 0,
    "Fee": Number(transaction.fee) || 0,
    "Donated": Number(transaction.donated) || 0,
    "Status": toSelectField(transaction.status),
    "Payment Method": toText(transaction.payment_method ?? transaction.method),
    "Campaign": toText(transaction.campaign?.title ?? transaction.campaign_code),
    "Transacted At": transaction.transacted_at ?? transaction.created_at ?? null,
    "Plan ID": toText(transaction.plan_id),
    "Is Recurring": Boolean(transaction.plan_id) || toBoolean(transaction.is_recurring),
    "Refunded": toBoolean(subTransaction.refunded) || Boolean(subTransaction.refunded_at),
    "Refunded At": toDateOnly(subTransaction.refunded_at),
    // Refunded Amount is deliberately NOT written here. Givebutter never reports a
    // refunded dollar amount anywhere on this object (only the boolean + timestamp
    // above), and this field's own description in Airtable says it "falls back to
    // the modelled 50%" when absent -- a fallback a staffer fills in by hand once a
    // refund is processed. Every write here is a partial update (both the REST PATCH
    // and the Scripting SDK leave an omitted field untouched), so leaving this key
    // out entirely lets that value stick instead of being forced back to 0 on every
    // sync run, which is what writing 0 here used to do.
    "Last Synced": syncedAt,
  };
}

// A transaction's Plan ID is Givebutter's own plan id (plain text, for matching/
// audit) -- this resolves that to the matching Recurring Plans row's Airtable
// record id, for the actual link field. `recurringPlanIdByPlanId` is a Plan ID ->
// Airtable record id map the caller builds once per run (nightly) or looks up
// per-event (webhook); returns null rather than an empty-array link patch when
// there's no Plan ID or no match yet -- a transaction can arrive before its plan has
// been synced, and leaving the link untouched (not forced empty) lets a later sync
// fill it in once the plan exists, instead of writing a wrong "no plan" answer.
export function recurringPlanLinkField(
  planId: string,
  recurringPlanIdByPlanId: Map<string, string>
): { "Recurring Plans": Array<{ id: string }> } | null {
  if (!planId) return null;
  const recurringPlanRecordId = recurringPlanIdByPlanId.get(planId);
  if (!recurringPlanRecordId) return null;
  return { "Recurring Plans": [{ id: recurringPlanRecordId }] };
}
