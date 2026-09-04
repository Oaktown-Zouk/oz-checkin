# Airtable automations — Changelog

Incident write-ups and design history for the scripts in this folder. See
[`README.md`](./README.md) for how these scripts are structured and what each one
currently does.

## 2026-09 grant-dropin-credits.js: no more Member lookup, no more Credits table

Moved off the row-per-credit `Credits` table: the script now just sets
`Transactions."Credits Purchased"` on the triggering record, which a `Members`
rollup picks up automatically. No `Member` lookup needed at all anymore, which also
fully retires the memberId-resolution bug below.

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

## 2026-09-03 grant-dropin-credits.js: memberId was a name, not a record id

The `memberIds` input variable resolved to the Member's display name rather than
its record id, so linking a new `Credits` row with it silently failed. Fixed by
reading `Member` directly off the `Transactions` record instead of trusting the
input variable — moot now that the script no longer looks up a Member at all (see
above).

## 2026-09-02 duplicate-Member investigation

A member ended up with 3 `Members` rows from two separate causes: a known
Givebutter-merge-leftover scenario, and a real race in `sync-givebutter-webhook.js`
where concurrent webhook events for one signup each independently created their own
row. Fixed the race by switching every find-or-create in the webhook script to
Airtable's atomic REST `performUpsert`, which can't be split across two concurrent
executions the way a plain query-then-create can.
