# OZ Check-In

Student check-in tool for Oaktown Zouk. See [`SPEC.md`](./SPEC.md) for the full design
and the reasoning behind it, and [`docs/airtable-schema.md`](./docs/airtable-schema.md)
for the Airtable schema/field reference.

```
server/             Hono API — Netlify Functions in production, runnable standalone
                     for local dev. Airtable is the system of record; no local database.
web/                 React + Vite front-desk SPA
netlify/functions/   The one Netlify Function (wraps the Hono app)
netlify.toml         Netlify build/functions/publish config
```

**Airtable is the database.** This app has no local database of its own — it reads and
writes an Airtable base directly over its REST API. `server/src/db/` (SQLite/Drizzle)
and `server/src/scripts/migrate*.ts` still exist only as the one-time migration path
that moved the *old* version of this app's data (which did run on local SQLite) into
Airtable; they're not part of the running app anymore and are slated for deletion once
that migration is fully trusted (see `SPEC.md`'s cutover notes).

## Prerequisites

- Node.js 22.5+
- npm
- An Airtable base with the schema this app expects (see `docs/airtable-schema.md`) and
  a Personal Access Token for it (`schema.bases:read`, `data.records:read`,
  `data.records:write`)
- A Google OAuth client (Google Cloud Console → APIs & Services → Credentials →
  "Create Credentials" → "OAuth client ID", type "Web application"). Add an
  "Authorized redirect URI" for every `APP_ORIGIN` this runs under (see `.env.example`):
  `http://localhost:5173/api/auth/google/callback` (`npm run dev`, two-terminal — note
  this is the Vite port, not the API's own :3000, since that's the origin the browser
  actually sees), `http://localhost:8888/api/auth/google/callback` (`netlify dev`), and
  the production domain once deployed.

## Setup

```bash
npm install

cp .env.example .env
# fill in AIRTABLE_PAT, AIRTABLE_BASE_ID, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

**Two env files exist, both needed, kept in sync manually:**
- **`.env`** (repo root) — read by `netlify dev`, which has no concept of workspace-
  specific env files.
- **`server/.env`** — read by `npm run dev` (the plain `@hono/node-server` path, not
  going through the Netlify runtime).

Both need the same five variables. `.env.example` (root) and `server/.env.example`
document them.

**Authorizing an account:** logging in only works for accounts with a row in the
`User Roles` Airtable table (`Email` → `Role`). Add a row there before anyone new tries
to sign in — there's no self-service signup. See `docs/airtable-schema.md`.

## Running locally

**Recommended — the real Netlify runtime:**

```bash
npm run dev:netlify
```

Runs the actual Netlify Dev proxy (Vite + the Function together) at
`http://localhost:8888` — the closest local approximation to production, since it's
the same routing/runtime Netlify uses when deployed. This is also what's meant by
"run it for real on my laptop" before deciding to deploy — there's no other local
"production mode" script; `netlify dev` **is** that mode here.

> `netlify-cli` auto-detects this as an npm-workspaces monorepo and normally prompts to
> pick one workspace as "the project," which doesn't fit this repo's shape (the real
> site spans both `server/` and `web/` via the root `netlify.toml`). `dev:netlify` is
> pre-wired with `--filter web` to skip that prompt — picking `web` still correctly
> resolves the root `netlify.toml`/`netlify/functions` (config resolution walks
> upward), and it's a natural fit anyway since `web` is what needs its own dev server
> (Vite) proxied alongside the Function.

**Faster iteration — standalone, no Netlify runtime:**

```bash
npm run dev:server    # terminal 1 — API on :3000 (@hono/node-server, auto-restarts)
npm run dev:web       # terminal 2 — SPA on :5173, proxying /api to :3000
```

Skips Netlify's function-bundling step on every change, at the cost of not exercising
the actual Netlify Functions runtime — reach for `dev:netlify` before trusting a change
that touches routing/deployment behavior specifically.

Either way: open the app (`:8888` or `:5173`) and sign in with Google — the account
needs a row in Airtable's `User Roles` table first (see above).

**Everything both modes talk to is the real Airtable base** — there's no local/seed
data mode anymore (the old SQLite-backed `npm run seed` is gone along with the
database it seeded). Use throwaway test records in Airtable directly if you need to
exercise a flow without touching real students — see the migration scripts and their
`--apply`-gated dry-run pattern for the general approach this project has used for
that.

## Testing

```bash
npm test          # server unit tests (node:test) — currently just lib/date.ts's
                   # pure functions; the Airtable-backed services have no local fake
                   # to test against (see below), so they're verified manually/live
npm run typecheck  # both workspaces + the Netlify function
npm run build      # both workspaces
```

There's no in-memory fake for Airtable's live formulas/automations (the Credits system,
tier gating, etc. depend on them), so service-level behavior is verified by hand
against the real base with throwaway records, not automated tests — see `SPEC.md`'s
"Credits system" section for what's actually being relied on there.

**TODO:** build or find a module that fakes the Airtable REST API (records + formula
evaluation) well enough to test `airtable/client.ts`'s callers without hitting the real
base. Would unlock real `services/*` unit tests instead of hand-verification against
live data — the main testing gap this project currently has.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev:netlify` | Real Netlify Dev runtime — recommended for anything beyond quick iteration |
| `npm run dev:server` / `npm run dev:web` | Two-terminal fast-iteration alternative |
| `npm run build` | Production build — `web/dist` (static) + compiled `server/dist` (unused by Netlify directly, but keeps the workspace typechecking/buildable standalone) |
| `npm run typecheck` | Type-check server, web, and the Netlify function |
| `npm test` | Server unit tests |
| `npm run migrate:airtable` / `npm run migrate:credits` | One-time historical-data migration scripts (already run against production — see `server/src/scripts/`) — dry-run by default, `--apply` to write |
| `npm run audit:credits` | Repeatable check: finds check-ins for a tier-less member (no `Tier Rule` link) missing a consumed credit, and links their oldest unclaimed available credit — dry-run by default, `--apply` to write. Reports (doesn't fabricate) a credit for gaps with none available. Worth re-running periodically if Automation C's reliability is in question. |
