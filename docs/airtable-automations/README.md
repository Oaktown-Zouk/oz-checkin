# Airtable automations

These scripts live in Airtable's own Automations / Scripting extension, not in this
repo's build or deploy — they run inside Airtable against the Givebutter API and
write directly to the base. They're mirrored here purely so we have version history
and can review/diff them outside Airtable's UI. Editing a file here does nothing;
the change has to be pasted back into the corresponding Airtable automation's script
step by hand.

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

See `docs/airtable-schema.md` for what each Airtable table/field means to this app.

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
