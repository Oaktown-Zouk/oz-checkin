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

// One field set for both the nightly sync and the webhook -- the nightly sync used
// to write a narrower set (no Plan ID / Is Recurring / Refunded fields), which meant
// any transaction only ever nightly-synced was indistinguishable from a plain
// one-time drop-in even when it was really a recurring membership charge (Transactions
// is "disambiguated by Is Recurring + Plan ID presence" per docs/airtable-schema.md --
// a disambiguation that silently didn't work for most rows). Full parity closes that
// gap regardless of which sync path a given transaction happened to go through.
export function buildTransactionFields(transaction: GivebutterTransactionPayload, syncedAt: string): Record<string, unknown> {
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
