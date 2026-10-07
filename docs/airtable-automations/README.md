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
  and creates/refreshes `Members` from `/plans`. Does **not** touch `Tier Rule` —
  that's `assign-member-tier.js`'s job now (see below); this sync used to re-link it
  off a member's pledged `Membership Amount`, which cleared a paused/canceled
  member's tier early, so that logic was removed.
- `sync-givebutter-contacts.js` — nightly scheduled automation (also runnable ad hoc
  from the Scripting extension for a manual full pull), upserts `Members` from
  `/contacts`.
- `sync-givebutter-transactions.js` — nightly scheduled automation, upserts
  `Transactions` and creates/fills `Members` from `/transactions`. Also runs a
  full-table first-time-membership rebate-eligibility pass every night (see
  `docs/airtable-schema.md`'s "Rebates" section) — self-healing, not scoped to the
  usual lookback window.
- `sync-givebutter-webhook.js` — real-time automation triggered by a Givebutter
  webhook (`plan.*`, `transaction.*`, `contact.created`), re-fetches the changed
  record and upserts it immediately rather than waiting for the nightly batch. Runs
  the same rebate-eligibility check as the nightly sync, but only for the one
  transaction this event just touched. `refund.*` events are logged only, not
  live-synced — a refund's own `data.transaction_id` is Givebutter's internal id,
  which their API never exposes a way to resolve to the actual transaction (confirmed
  directly against the live API — see the script's own file-header comment); the
  nightly sync already re-pulls every transaction's real refunded state on its own,
  so a refund just takes up to a day to land instead of being near-instant.

`grant-dropin-credits.js`, `assign-member-tier.js` and `link-class-feedback-session.js`
are different from the four
above: none is triggered by anything Givebutter-shaped, and all are plain
hand-maintained files — not generated, no `src`/`bodies` split, since each is small
enough not to warrant one. Edit them directly and paste the result into Airtable.

- `grant-dropin-credits.js` (see `docs/airtable-schema.md`'s "Credits" section) —
  triggered by every `Transactions` record being created; does its own qualifying
  check internally rather than relying on a filtered trigger view.
- `assign-member-tier.js` (see `docs/airtable-schema.md`'s "Tier Rule" section) —
  the sole source of truth for `Members."Tier Rule"`, keyed off actual payments in
  the last 30 days (`Current Membership Payment`, itself a formula/rollup — see the
  script's own header) rather than a pledged plan amount, so pausing or canceling a
  membership doesn't clear a tier the member already paid for and still has time
  left on. Wired up two ways: immediately via a `Members` "when record updated"
  automation (`RUN_MODE = 'single'`), and as a backstop/manual re-sweep from the
  Scripting extension (`RUN_MODE = 'all'`) — run the latter by hand after editing
  the `Tiers` table itself.
- `link-class-feedback-session.js` — links each `Class Feedback` record to its
  `Sessions` record: `Class` ("Level 2") picks the `Program` ("Zouk L2"), then the
  session on the submitter's `Date` if given, else the latest session starting at
  or before submission (`Original Submission Date`, else `Created`); the feedback's
  `Instructors` lookup follows that link. Wired up via a `Class Feedback` "when
  record created" automation (`RUN_MODE = 'single'`), with `RUN_MODE = 'all'` from
  the Scripting extension as a re-sweep after adding missing Sessions.

See `docs/airtable-schema.md` for what each Airtable table/field means to this app.

## Gotchas

- **REST vs. Scripting SDK cell-value shapes differ**, for select and linked-record
  fields specifically: the Scripting SDK (`table.createRecordsAsync()` etc., used by
  the nightly scripts) wants `{name: "..."}` for a select and `[{id: "recXXX"}]` for
  a link; the raw REST API (`performUpsert`, used by the webhook script) wants a
  plain string and a plain array of id strings respectively, and rejects the
  Scripting-shaped object with a 422 instead of coercing it. Every REST write goes
  through `toRestFields()` (`server/airtable-automations/src/restFields.ts`) to
  flatten the shared field-builders' output into REST-safe form before sending.
- **`sync-givebutter-webhook.js` upserts via REST's `performUpsert`, not
  `selectRecordsAsync()` + `createRecordAsync()`**, specifically so that two webhook
  events for the same contact firing in quick succession can't both create a
  duplicate `Members` row — Airtable executes `performUpsert` as a single atomic
  find-or-create server-side. Needs its own Personal Access Token
  (`data.records:read`/`write`, scoped to this base) since `performUpsert` is a REST
  API feature `base.getTable()` doesn't expose — see the script's own SETUP section.

See [`CHANGELOG.md`](./CHANGELOG.md) for the incidents that drove these design
decisions.
