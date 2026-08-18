import { eq } from "drizzle-orm";
import { config, givebutterConfigured } from "../config.js";
import { db } from "../db/client.js";
import { givebutterContacts, memberships, membershipCharges, payments, syncState } from "../db/schema.js";
import { upsertStudent } from "../lib/upsertStudent.js";

// Field names below are verified against real /contacts, /transactions, and /plans
// responses from the OZ Givebutter account (2026-08-08) — see SPEC.md. Notable, non-obvious
// findings from that check:
//  - Pagination is Laravel-style { data, links, meta }.
//  - Transactions and plans both carry contact_id/email/first_name/last_name directly —
//    no need to cross-reference /contacts for the common case. The contacts map below is
//    only a fallback for records that (unexpectedly) lack a direct email.
//  - Amounts are plain dollar floats (e.g. 95, or 3.15 for a fee), not cents.
//  - A transaction that's the initial or renewal charge of a recurring plan carries that
//    plan's id in `plan_id`. Those must NOT also become a redeemable one-time credit —
//    the matching `memberships` row already represents that student's access — but they
//    are recorded as history in `membershipCharges` (see schema.ts) so front desk can see
//    when a member last actually paid. Only transactions with plan_id == null are
//    "bought N passes" one-time purchases that become a `payments` row.
//  - Plans expose `next_bill_date` (format "YYYY-MM-DD HH:MM:SS", no offset) — this is
//    the "current period end" signal that was an open question in SPEC.md; it's resolved.
// Known gap, out of scope for v1: a transaction's nested `transactions[]` array can carry
// per-installment refund info that isn't reflected in the top-level `status` — a refund
// after the fact won't un-redeem a credit or retroactively revoke a checked-in visit.

const BASE_URL = "https://api.givebutter.com/v1";

async function givebutterGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.GIVEBUTTER_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Givebutter API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchAllPages(path: string): Promise<any[]> {
  const results: any[] = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const json = await givebutterGet(path, { page: String(page), per_page: String(perPage) });
    // Handle both a bare array response and a Laravel-style { data, links, meta } wrapper.
    const items: any[] = Array.isArray(json) ? json : (json.data ?? []);
    results.push(...items);

    const hasMore = Array.isArray(json)
      ? items.length === perPage
      : Boolean(json.links?.next) ||
        (json.meta ? json.meta.current_page < json.meta.last_page : false);

    if (!hasMore || items.length === 0) break;
    page++;
  }

  return results;
}

function contactEmail(contact: any): string | undefined {
  return (
    contact?.primary_email ??
    contact?.email ??
    contact?.emails?.find((e: any) => e?.type === "primary")?.value ??
    contact?.emails?.[0]?.value
  );
}

function contactName(contact: any): string | undefined {
  if (contact?.name) return contact.name;
  const first = contact?.first_name ?? "";
  const last = contact?.last_name ?? "";
  const full = `${first} ${last}`.trim();
  return full || undefined;
}

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

// Givebutter timestamps on plans (next_bill_date, start_at, canceled_at) come as
// "YYYY-MM-DD HH:MM:SS" with no offset — replacing the space with "T" makes this parse
// as local time per the ECMA-262 Date Time String spec (rather than V8's non-standard
// handling of the space-separated form), consistent across engines.
function parseGivebutterTimestamp(value: unknown): Date | null {
  if (!value) return null;
  return new Date(String(value).replace(" ", "T"));
}

export interface SyncResult {
  skipped: boolean;
  processed?: number;
  unmatched?: number;
}

export async function syncGivebutter(): Promise<{
  contacts: SyncResult;
  payments: SyncResult;
  membershipCharges: SyncResult;
  memberships: SyncResult;
}> {
  if (!givebutterConfigured) {
    return {
      contacts: { skipped: true },
      payments: { skipped: true },
      membershipCharges: { skipped: true },
      memberships: { skipped: true },
    };
  }

  const contacts = await fetchAllPages("/contacts");
  const contactsById = new Map<string, any>(contacts.map((c) => [String(c.id), c]));

  // Policy: every Givebutter contact becomes a student, not just ones with a payment or
  // plan — e.g. someone added as a contact who hasn't paid yet and is going to use their
  // free drop-in credit instead (see lib/upsertStudent.ts, granted automatically on
  // creation). Runs before transactions/plans so the roster is populated first; order
  // doesn't actually matter for correctness since upsertStudent is idempotent either way.
  const contactsResult = await syncContacts(contacts);
  const transactionsResult = await syncTransactions(contactsById);
  const membershipsResult = await syncPlans(contactsById);

  return {
    contacts: contactsResult,
    payments: transactionsResult.credits,
    membershipCharges: transactionsResult.membershipCharges,
    memberships: membershipsResult,
  };
}

// Links a Givebutter contact id to a student — the signal used by the merge
// guardrails to know a student "has Givebutter on file" (see services/merge.ts).
async function linkGivebutterContact(studentId: number, contactId: unknown): Promise<void> {
  if (contactId === undefined || contactId === null) return;
  await db
    .insert(givebutterContacts)
    .values({ studentId, givebutterContactId: String(contactId) })
    .onConflictDoUpdate({
      target: givebutterContacts.givebutterContactId,
      set: { studentId, updatedAt: new Date() },
    });
}

async function syncContacts(contacts: any[]): Promise<SyncResult> {
  let processed = 0;
  let unmatched = 0;

  for (const contact of contacts) {
    const email = contactEmail(contact);
    if (!email) {
      unmatched++;
      continue;
    }
    const studentId = await upsertStudent(email, contactName(contact) ?? email, "givebutter");
    await linkGivebutterContact(studentId, contact.id);
    processed++;
  }

  return { skipped: false, processed, unmatched };
}

async function resolveStudentIdForRecord(record: any, contactsById: Map<string, any>): Promise<
  number | undefined
> {
  // Transactions and plans both carry these directly (verified) — prefer them over any
  // contact lookup.
  const directEmail =
    record.email ?? record.primary_email ?? record.giving_space?.email ?? record.donor?.email;
  const directFullName = `${record.first_name ?? ""} ${record.last_name ?? ""}`.trim();
  const directName = directFullName || record.name || record.giving_space?.name;
  const contactId = record.contact_id ?? record.contact?.id;

  if (directEmail) {
    const studentId = await upsertStudent(directEmail, directName || directEmail, "givebutter");
    await linkGivebutterContact(studentId, contactId);
    return studentId;
  }

  if (contactId !== undefined && contactId !== null) {
    const contact = contactsById.get(String(contactId));
    const email = contactEmail(contact);
    if (email) {
      const studentId = await upsertStudent(email, contactName(contact) ?? email, "givebutter");
      await linkGivebutterContact(studentId, contactId);
      return studentId;
    }
  }

  return undefined;
}

async function syncTransactions(
  contactsById: Map<string, any>
): Promise<{ credits: SyncResult; membershipCharges: SyncResult }> {
  const transactions = await fetchAllPages("/transactions");

  let creditsProcessed = 0;
  let creditsUnmatched = 0;
  let chargesProcessed = 0;
  let chargesUnmatched = 0;

  for (const tx of transactions) {
    const status = String(tx.status ?? "").toLowerCase();
    if (status !== "succeeded" && status !== "success" && status !== "completed") continue;

    const studentId = await resolveStudentIdForRecord(tx, contactsById);
    if (!studentId) {
      if (tx.plan_id) chargesUnmatched++;
      else creditsUnmatched++;
      continue;
    }

    const txId = String(tx.id);
    const amountCents = dollarsToCents(Number(tx.amount ?? 0));
    const paidAt = new Date(tx.created_at ?? Date.now());

    // A transaction tied to a recurring plan (the plan's first charge, or a renewal) is
    // NOT a one-time "bought a pass" purchase — the matching `memberships` row already
    // represents that student's access — so it's recorded as history, not a redeemable
    // credit. Only transactions with plan_id == null become a `payments` row.
    if (tx.plan_id) {
      const planIdStr = String(tx.plan_id);
      // A charge's holder always follows its plan's CURRENT holder, not this
      // transaction's own payer — that's what makes a transferred membership's future
      // (and, refreshed here, past) charges show up under the new holder. Falls back to
      // the transaction's own resolved payer if the plan hasn't synced yet (e.g. this is
      // the plan's very first charge, processed before syncPlans creates the row below)
      // — self-corrects on the next sync once the membership row exists.
      const [existingMembership] = await db
        .select({ holderStudentId: memberships.holderStudentId })
        .from(memberships)
        .where(eq(memberships.givebutterPlanId, planIdStr));
      const holderStudentId = existingMembership?.holderStudentId ?? studentId;

      await db
        .insert(membershipCharges)
        .values({
          studentId,
          holderStudentId,
          givebutterPlanId: planIdStr,
          givebutterTransactionId: txId,
          amountCents,
          paidAt,
        })
        .onConflictDoUpdate({
          target: membershipCharges.givebutterTransactionId,
          set: { studentId, holderStudentId, amountCents, updatedAt: new Date() },
        });
      chargesProcessed++;
      continue;
    }

    const existing = await db
      .select()
      .from(payments)
      .where(eq(payments.givebutterTransactionId, txId));

    if (existing.length === 0) {
      // holderStudentId starts equal to studentId and is never touched again by sync —
      // only an explicit transfer (services/transfers.ts) changes it. studentId itself
      // stays purely informational (who Givebutter says paid) and is safe to refresh.
      await db.insert(payments).values({
        studentId,
        holderStudentId: studentId,
        givebutterTransactionId: txId,
        amountCents,
        paidAt,
      });
    } else {
      await db
        .update(payments)
        .set({ studentId, amountCents, updatedAt: new Date() })
        .where(eq(payments.givebutterTransactionId, txId));
    }

    creditsProcessed++;
  }

  return {
    credits: { skipped: false, processed: creditsProcessed, unmatched: creditsUnmatched },
    membershipCharges: { skipped: false, processed: chargesProcessed, unmatched: chargesUnmatched },
  };
}

async function syncPlans(contactsById: Map<string, any>): Promise<SyncResult> {
  const plans = await fetchAllPages("/plans");

  let processed = 0;
  let unmatched = 0;

  for (const plan of plans) {
    const studentId = await resolveStudentIdForRecord(plan, contactsById);
    if (!studentId) {
      unmatched++;
      continue;
    }

    const planId = String(plan.id);
    const status = String(plan.status ?? "unknown");
    const frequency = plan.frequency ? String(plan.frequency) : null;
    const amountCents = plan.amount != null ? dollarsToCents(Number(plan.amount)) : null;
    const currentPeriodEnd = parseGivebutterTimestamp(plan.next_bill_date);
    const startedAt = parseGivebutterTimestamp(plan.start_at);
    const canceledAt = parseGivebutterTimestamp(plan.canceled_at);

    // holderStudentId starts equal to studentId and is never touched again by sync —
    // only an explicit transfer (services/transfers.ts) changes it. studentId itself
    // stays purely informational (who Givebutter says pays) and is safe to refresh.
    await db
      .insert(memberships)
      .values({
        studentId,
        holderStudentId: studentId,
        givebutterPlanId: planId,
        status,
        frequency,
        amountCents,
        currentPeriodEnd,
        startedAt,
        canceledAt,
      })
      .onConflictDoUpdate({
        target: memberships.givebutterPlanId,
        set: {
          studentId,
          status,
          frequency,
          amountCents,
          currentPeriodEnd,
          startedAt,
          canceledAt,
          updatedAt: new Date(),
        },
      });

    processed++;
  }

  await db
    .insert(syncState)
    .values({ source: "givebutter", lastSyncedAt: new Date(), cursor: null })
    .onConflictDoUpdate({
      target: syncState.source,
      set: { lastSyncedAt: new Date() },
    });

  return { skipped: false, processed, unmatched };
}
