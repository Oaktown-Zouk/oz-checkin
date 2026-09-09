import { toText, toDateOnly, toSelectField } from "./text.js";

export interface GivebutterPlanPayload {
  id?: unknown;
  status?: unknown;
  amount?: unknown;
  frequency?: unknown;
  method?: unknown;
  fee_covered?: unknown;
  start_at?: unknown;
  next_bill_date?: unknown;
  canceled_at?: unknown;
}

// Shared by the nightly Plans script and the webhook -- both write the exact
// same field set for a Recurring Plan.
export function buildRecurringPlanFields(plan: GivebutterPlanPayload, syncedAt: string): Record<string, unknown> {
  return {
    "Plan ID": String(plan.id),
    "Status": toSelectField(plan.status),
    "Amount": Number(plan.amount) || 0,
    "Frequency": toSelectField(plan.frequency),
    "Method": toText(plan.method),
    "Fee Covered": Boolean(plan.fee_covered),
    "Start Date": toDateOnly(plan.start_at),
    "Next Bill Date": toDateOnly(plan.next_bill_date),
    "Canceled At": toDateOnly(plan.canceled_at),
    "Last Synced": syncedAt,
  };
}

// The three-way decision behind "default the beneficiary to the payer, but
// never overwrite a manual gift assignment" -- pulled out on its own because
// it was at the heart of the 2026-09-02 duplicate-Member incident (see
// README): two concurrent executions must resolve this identically given the
// same inputs, or Covers Member can end up split across two different Member
// rows.
export function shouldAssignCoversMember(hasMemberRecordId: boolean, alreadyAssigned: boolean): boolean {
  return hasMemberRecordId && !alreadyAssigned;
}

export interface TierRule {
  id: string;
  name: string | null;
  min: number;
}

// Tiers must already be sorted richest-first by the caller; picks the first
// (highest) tier whose minimum price the amount still clears. Matches on
// AMOUNT, not tier name, since Tier Rule is itself derived from this match --
// matching by name would be circular.
export function tierRuleForAmount(tierRules: TierRule[], amount: number): TierRule | null {
  if (!amount || amount <= 0) return null;
  return tierRules.find((rule) => amount >= rule.min) ?? null;
}

// null means no write is needed -- the link already points at the right
// place, including "correctly still empty" when no tier matches.
export function tierRuleLinkFields(
  desiredTierRule: TierRule | null,
  currentTierRuleId: string | null
): { "Tier Rule": Array<{ id: string }> } | null {
  const desiredId = desiredTierRule?.id ?? null;
  if (desiredId === currentTierRuleId) return null;
  return { "Tier Rule": desiredTierRule ? [{ id: desiredTierRule.id }] : [] };
}
