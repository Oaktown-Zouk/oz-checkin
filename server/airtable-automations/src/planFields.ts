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

// Tier Rule used to be maintained here (off a member's pledged Membership Amount),
// but that clobbered a paused/canceled member's tier early -- Membership Amount
// goes blank with no active plan to read it from, even though they may have paid
// within the last 30 days and have plenty of time left on what they paused. Tier
// assignment now lives entirely in its own Airtable automation, keyed off actual
// payments in the last 30 days via formula/rollup fields -- see
// docs/airtable-automations/assign-member-tier.js and docs/airtable-schema.md's
// "Tier Rule" section. This sync no longer touches Tier Rule at all.
