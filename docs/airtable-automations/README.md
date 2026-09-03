# Airtable automations

These scripts run inside Airtable's own Automations / Scripting extension, not in
this repo's build or deploy — against the Givebutter API, writing directly to the
base.

**The files in this folder are GENERATED — do not hand-edit them.** Airtable's
Scripting sandbox has no `import`/`require`, so every script pasted into it has to
be one self-contained blob. To still get real, tested modularity, the actual source
lives in [`server/airtable-automations/`](../../server/airtable-automations/):

- `server/airtable-automations/src/*.ts` — pure functions (no `base`/`fetch` calls),
  each with a colocated `*.test.ts` covering the edge cases (blank/null values,
  Givebutter's `Boolean("false")` string-boolean trap, multi-word last names, select
  fields needing `{name: "..."}` not a bare string, etc.). Run with `npm test
  --workspace server` (they're auto-discovered alongside the rest of the server's
  tests) or `npm run typecheck:automations --workspace server`.
- `server/airtable-automations/bodies/*.body.js` — each automation's own
  Airtable-specific orchestration (`base.getTable()`, `fetch()`, `input.config()`),
  calling into the tested functions above. This is intentionally thin — the
  edge-case-heavy logic lives in `src/`, not here.
- `server/airtable-automations/build.ts` — concatenates `src/` + the matching
  `bodies/*.body.js` into the files in *this* folder. Run via
  `npm run build:automations --workspace server`.

Workflow: edit `src/` or `bodies/`, run the tests, run the build, review the diff in
this folder, paste the regenerated file into the corresponding Airtable automation's
script step by hand.

- `sync-givebutter-plans.js` — nightly scheduled automation, upserts `Recurring Plans`
  and creates/refreshes `Members` from `/plans`. Also maintains `Tier Rule` links.
- `sync-givebutter-contacts.js` — nightly scheduled automation (also runnable ad hoc
  from the Scripting extension for a manual full pull), upserts `Members` from
  `/contacts`.
- `sync-givebutter-transactions.js` — nightly scheduled automation, upserts
  `Transactions` and creates/fills `Members` from `/transactions`.
- `sync-givebutter-webhook.js` — real-time automation triggered by a Givebutter
  webhook (`plan.*`, `transaction.*`, `refund.*`, `contact.created`), re-fetches the
  changed record and upserts it immediately rather than waiting for the nightly batch.

`grant-dropin-credits.js` is different from the four above: it's **Automation B**
(see `docs/airtable-schema.md`'s "Credits" section), triggered by a qualifying
`Transactions` record rather than anything Givebutter-shaped, and it's a plain
hand-maintained file — not generated, no `src`/`bodies` split, since it's small
enough not to warrant one. Edit it directly and paste it into Airtable.

See `docs/airtable-schema.md` for what each Airtable table/field means to this app.

## 2026-09-03 Transactions never got Plan ID / Is Recurring / Refunded* from the nightly sync

`Transactions` is documented as "disambiguated by `Is Recurring` + `Plan ID`
presence," but only the webhook ever wrote either — `sync-givebutter-transactions.js`
(the complete, authoritative sync; the webhook is best-effort) wrote neither, nor
the `Refunded*` fields. Any transaction that was only ever nightly-synced was
therefore indistinguishable from a plain one-time drop-in even when it was really a
recurring membership charge — and `grant-dropin-credits.js`'s own membership-vs-drop-in
check reads exactly this signal, so it could be fooled into granting a drop-in
credit for a real membership payment.

Fixed by giving the nightly sync the same field set the webhook already wrote
(`buildTransactionFields` in `server/airtable-automations/src/transactionFields.ts`,
now shared by both instead of two near-duplicate functions). Also added, on request:
a real `Recurring Plans` link field on `Transactions` (not just the plain-text
`Plan ID`), resolved via the new `recurringPlanLinkField` — populated by both the
nightly sync (via a Plan-ID-keyed map built once per run) and the webhook (a direct
lookup per event, mirroring how the webhook already looks up Covers Member).
`recurringPlanLinkField` returns `null` rather than an empty link when the matching
plan hasn't been synced yet — an out-of-order webhook, or a transaction referencing
a plan the nightly sync hasn't reached — so a later sync fills it in instead of a
wrong "no plan" being written and stuck.

**Requires manual setup before pasting these in:** create a `Recurring Plans` field
on `Transactions` (Link to another record → `Recurring Plans`) by hand — automations
can't add fields. Then, to backfill every already-synced transaction (not just future
ones), temporarily set `sync-givebutter-transactions.js`'s `LOOKBACK_DAYS` to `3650`,
run it once manually, then set it back to `7` before re-enabling the schedule — the
same backfill mechanism the script's own header already documented for the initial
historical pull.

## 2026-09-03 grant-dropin-credits.js: memberId was a name, not a record id

`input.config()`'s `memberIds` input variable was mapped to the linked `Member`
field's *primary field value* (the person's name) rather than its record id —
Airtable's automation input-variable UI defaults to that unless you dig in and pick
the record id explicitly. `"Member": [{id: memberId}]` then tried to link a new
`Credits` record using a name string as if it were an Airtable record id, which
doesn't resolve to anything.

Fixed by not trusting the input variable for this at all: the script now fetches the
`Transactions` record directly by `transactionId` and reads its own `Member` field,
which the Scripting API always returns as real `{id, name}` linked-record objects
regardless of how any input variable happens to be configured. Also fixed in the same
pass: `creditsTable.createRecordsAsync(...)` was missing its `await` (the run could
finish, and Airtable would mark it successful, before the credits were actually
written — and any creation error would be silently dropped), and the final log line
interpolated the whole `creditsToCreate` array instead of `.length`.

## 2026-09-02 duplicate-Member investigation

a member ended up with 3 `Members` rows, merged via `mergeMembers` — see
`server/src/services/merge.ts`. Two different root causes, not one:

- The older row (Contact ID 43919301, created 2026-08-21) is the scenario
  `airtable-schema.md`'s `Duplicate` field doc already describes: a Givebutter-side
  contact merge that leaves the old contact_id still resolvable via the API, so our
  sync (correctly, from its point of view) keeps it as a separate `Members` row.
  Not a bug in these scripts.

- The same-day pair (Contact ID 44573119, both rows created at the same second,
  2026-09-02T17:53:43Z) is a real race condition in `sync-givebutter-webhook.js`.
  A new membership signup fires multiple webhook events for the same contact in
  quick succession (e.g. `plan.created`/`plan.updated` alongside the first
  `transaction.succeeded`). Airtable runs each webhook trigger firing as its own
  independent script execution — there's no serialization across them. Each
  execution's `memberFor()` does an unlocked read-then-create: it queries `Members`
  for an existing `Contact ID`, finds nothing (because neither execution's create has
  landed yet), and each independently creates its own `Members` row for the same
  Givebutter contact. Whichever execution's `Recurring Plans` upsert lands last wins
  the `Member` (payer) field while the other's earlier write survives in
  `Covers Member` — because the "never overwrite an assigned `Covers Member`" guard
  (there for legitimate gift memberships) treats the race's accidental first write as
  if it were a real manual assignment, so nothing ever self-heals it.

  Confirmed via Airtable's `Sync Log` table: the three nightly scripts all log a row
  there; the webhook script never did, and there was no `Sync Log` entry anywhere near
  17:53:43 UTC that day — consistent with the webhook path, not the nightly batch,
  having created these two rows.

  **Fixed** in `sync-givebutter-webhook.js`: a re-check-after-create (keep whichever
  row is oldest) was considered and rejected — it only decides which existing row to
  *link*, it doesn't stop the second row from being created in the first place, and
  the two duplicate rows in this incident have byte-identical `createdTime` values, so
  "oldest" isn't even reliably ordered. A lock record doesn't work either: acquiring
  the lock is itself the same read-then-write race, just moved to a different table —
  Airtable's Scripting API has no compare-and-swap to build a real lock out of.

  The actual fix moves the existence check out of script code entirely: every
  find-or-create in the webhook script now goes through Airtable's REST API
  `performUpsert` (`PATCH .../records` with `fieldsToMergeOn`), which Airtable's own
  backend executes as a single atomic operation. Two concurrent webhook executions
  upserting the same Contact ID can't both create a row — one creates, the other
  necessarily updates the row the first one just made, so they converge on the same
  Member id instead of splitting across two. This needs a dedicated Airtable Personal
  Access Token (`data.records:read`/`write`, scoped to this base only — see the
  script's own SETUP section) since `performUpsert` is a REST API feature, not
  something `base.getTable()` exposes. The script also now logs to `Sync Log` (as
  `Script: "Webhook"`) the same way the nightly scripts do, so a run dying partway is
  visible instead of invisible the way it was during this incident.
