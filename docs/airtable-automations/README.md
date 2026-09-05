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

`grant-dropin-credits.js` is different from the four above (see `docs/airtable-
schema.md`'s "Credits" section): it's triggered by every `Transactions` record
being created, not anything Givebutter-shaped, and does its own qualifying check
internally rather than relying on a filtered trigger view. It's also a plain
hand-maintained file — not generated, no `src`/`bodies` split, since it's small
enough not to warrant one. Edit it directly and paste it into Airtable.

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
