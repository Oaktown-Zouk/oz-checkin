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
  refunded?: unknown;
  refunded_at?: unknown;
  refunded_amount?: unknown;
}

// The nightly Transactions script's field set -- deliberately narrower than
// the webhook's below (no Plan ID / Is Recurring / Refunded fields). Kept as
// a separate function rather than unified with buildWebhookTransactionFields:
// making them the same function would either add fields the nightly sync has
// never written, or drop fields the webhook depends on -- both real behavior
// changes, not just a refactor.
export function buildNightlyTransactionFields(transaction: GivebutterTransactionPayload, syncedAt: string): Record<string, unknown> {
  return {
    "Transaction ID": String(transaction.id),
    "Amount": Number(transaction.amount) || 0,
    "Fee": Number(transaction.fee) || 0,
    "Donated": Number(transaction.donated) || 0,
    "Status": toSelectField(transaction.status),
    "Payment Method": toText(transaction.payment_method ?? transaction.method),
    "Campaign": toText(transaction.campaign?.title ?? transaction.campaign_code),
    "Transacted At": transaction.transacted_at ?? transaction.created_at ?? null,
    "Last Synced": syncedAt,
  };
}

export function buildWebhookTransactionFields(transaction: GivebutterTransactionPayload, syncedAt: string): Record<string, unknown> {
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
    "Refunded": toBoolean(transaction.refunded) || Boolean(transaction.refunded_at),
    "Refunded At": toDateOnly(transaction.refunded_at),
    "Refunded Amount": Number(transaction.refunded_amount ?? 0) || 0,
    "Last Synced": syncedAt,
  };
}
