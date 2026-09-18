# Airtable automations — Changelog

Incident write-ups and design history for the scripts in this folder. See
[`README.md`](./README.md) for how these scripts are structured and what each one
currently does.

## 2026-09-17 nightly Transactions sync missed refunds on old transactions

Even after the `Refunded`/`Refunded At` nesting fix below, a real refund still
didn't land — the pull window filters on `transactedAfter` (a transaction's
original date), so a refund on a transaction from outside `LOOKBACK_DAYS` never
entered the pulled set at all, no matter how recent the refund itself was.
Confirmed against the live API that Givebutter also honors `updatedAfter`, which
starts equal to a transaction's `created_at` and only moves forward when
something later changes it — switched to that instead. Strictly better, not a
tradeoff: it still catches every new transaction the old filter did, plus now
catches state changes on old ones.

Also found the sync had been unconditionally writing `Refunded Amount: 0` on
every transaction, every run — Givebutter never reports a refunded dollar figure
anywhere (only a `refunded` boolean + timestamp), and this field's own
description says it's meant to fall back to a staffer's manual entry when
absent. Writing `0` explicitly (rather than omitting the field) defeated that
fallback on every sync. Fixed by dropping the field from the write entirely — an
omitted field is a partial-update no-op in both the REST PATCH and the Scripting
SDK, so a manually-entered value now survives future syncs.

## 2026-09-17 refunds: unresolvable webhook id, and Refunded/Refunded At never actually worked

The first real `refund.created` webhook 404'd on `/transactions/{resourceId}` —
`resourceId` was bound to the payload's `data.id`, but that's the refund's own id,
not the transaction's. Re-mapping to `data.transaction_id` didn't fix it either:
confirmed against the live API that value is Givebutter's internal transaction id,
matching neither the transaction's public `id` nor its `number` nor anything else
exposed. No endpoint resolves it. `refund.*` events are now logged only, not
live-synced — deferred to the nightly sync instead.

Investigating this surfaced a separate, bigger bug: `buildTransactionFields` had
been reading `refunded`/`refunded_at` off the top level of Givebutter's transaction
object, but real responses always nest those one level down, in `transactions[0]`.
`Refunded` had silently evaluated `false` for every transaction ever synced, on
both the webhook and nightly paths, since this code went live — independent of the
webhook id issue above. Fixed by reading the nested entry instead.

## 2026-09-16 webhook 422 on the rebate-eligibility member fetch

`fetchAirtableRecordById` (added for the rebate-eligibility check) passed a
`fields[]=...` query param the way the list endpoint wants — but Airtable's
single-record GET doesn't accept that parameter at all, 422ing with
`INVALID_REQUEST_UNKNOWN` on every rebate check. Fixed by dropping the param; the
single-record response already returns every field regardless.

## 2026-09 grant-dropin-credits.js: no more Member lookup, no more Credits table

Moved off the row-per-credit `Credits` table: the script now just sets
`Transactions."Credits Purchased"` on the triggering record, which a `Members`
rollup picks up automatically. No `Member` lookup needed at all anymore.

## 2026-09-03 webhook 422s: REST wants plain values, not Scripting SDK shapes

The REST API wants a select field as a plain string and a linked record as a plain
array of id strings, not the Scripting SDK's `{name: "..."}` / `[{id: "..."}]`
shapes — `typecast: true` had been masking the first 422 rather than actually
fixing it. Fixed with `toRestFields()`, applied once inside `upsertAirtableRecord`
so it covers both field types (and any future one) at the single REST-write
chokepoint.

## 2026-09-03 Transactions never got Plan ID / Is Recurring / Refunded* from the nightly sync

Only the webhook wrote these fields, so a nightly-only-synced transaction looked
like a plain one-time drop-in even when it was really a recurring membership
charge, which could fool `grant-dropin-credits.js`'s membership-vs-drop-in check.
Fixed by sharing one field-builder between both sync paths, plus adding a real
`Recurring Plans` link field on `Transactions`.

## 2026-09-02 duplicate-Member investigation

A member ended up with 3 `Members` rows from two separate causes: a known
Givebutter-merge-leftover scenario, and a real race in `sync-givebutter-webhook.js`
where concurrent webhook events for one signup each independently created their own
row. Fixed the race by switching every find-or-create in the webhook script to
Airtable's atomic REST `performUpsert`, which can't be split across two concurrent
executions the way a plain query-then-create can.
