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
writes an Airtable base directly over its REST API. An earlier version of this app ran
on local SQLite; that code (and the one-time migration scripts that moved its data into
Airtable) has been deleted now that the migration is fully trusted — see git history if
you need it for reference.

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
# fill in AIRTABLE_PAT, AIRTABLE_BASE_ID, SESSION_SECRET, APP_ORIGIN, GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET; leave DEV_LOGIN_ENABLED unless you want the dev-login escape
# hatch (see .env.example's comment on it)
```

**Two env files exist, both needed, kept in sync manually:**
- **`.env`** (repo root) — read by `netlify dev`, which has no concept of workspace-
  specific env files.
- **`server/.env`** — read by `npm run dev` (the plain `@hono/node-server` path, not
  going through the Netlify runtime).

Both need the same six required variables, plus the optional `DEV_LOGIN_ENABLED`.
`.env.example` (root) and `server/.env.example` document them.

**Authorizing an account:** logging in only works for accounts with a row in the
`User Roles` Airtable table (`Email` → a linked `Role Permissions` row, which is what
actually determines what the account can do — see `docs/airtable-schema.md`). Add a
row there before anyone new tries to sign in — there's no self-service signup.

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

Both `dev:netlify` and the two-terminal mode above talk to the **real Airtable base**
by default — for a local/seed data mode with no risk to real student data, see
"Sandbox mode" below.

**Sandbox mode** — the real app running against an in-memory mock of Airtable instead
of the live base:

```bash
npm run dev:sandbox
```

Runs the plain node server (`:3000`, `MOCK_AIRTABLE=true`) and Vite (`:5199`)
together. Sign in via the dev-login escape hatch (e.g.
`http://localhost:5199/api/auth/dev-login?email=claude-staff@test.com` — see
`SPEC.md`'s "Auth" section for the full allowlist) rather than real Google OAuth,
against `server/src/airtable/sandboxSeed.ts`'s fixture students. To try password login
instead (the identifier/password fields right on the same login screen, alongside the
Google button — see `SPEC.md`'s "Auth" section), use `sandboxSeed.ts`'s
`KIOSK_PASSWORD_LOGIN` fixture credentials. Hit
`POST /api/dev/reset-mock` to reseed back to those fixtures without restarting the
server — useful mid-session if you've mutated the sandbox's state and want a clean
slate. See `SPEC.md`'s "Testing" section for what the mock does and doesn't compute,
and why this doesn't run under `netlify dev`.

## Testing

```bash
npm test           # server unit tests (node:test), against the mock — fast, no network
npm run dev:sandbox # then exercise flows by hand against fixture data (see above)
npm run test:e2e    # Playwright, boots its own sandbox — see SPEC.md's "Testing"
npm run typecheck   # both workspaces + the Netlify function
npm run build       # both workspaces
```

One-time setup for `test:e2e`: `npx playwright install chromium` (add
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` if you're on macOS 13 — see `SPEC.md`).

`server/src/scripts/auditCreditConsumption.ts` is a separate thing: a one-off/periodic
maintenance script that runs against the **real** base (dry-run by default,
`--apply` to write) — not part of the test suite.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev:netlify` | Real Netlify Dev runtime — recommended for anything beyond quick iteration |
| `npm run dev:server` / `npm run dev:web` | Two-terminal fast-iteration alternative |
| `npm run dev:sandbox` | Two-terminal, but against the in-memory Airtable mock instead of the real base — see "Sandbox mode" above |
| `npm run build` | Production build — `web/dist` (static) + compiled `server/dist` (unused by Netlify directly, but keeps the workspace typechecking/buildable standalone) |
| `npm run typecheck` | Type-check server, web, and the Netlify function |
| `npm test` | Server unit tests, against the mock |
| `npm run test:e2e` | Playwright E2E specs, against a sandbox Playwright boots itself |
| `npm run audit:credits` | Repeatable check: finds check-ins for a tier-less member (no `Tier Rule` link) missing a consumed credit, and links their oldest unclaimed available credit — dry-run by default, `--apply` to write. Reports (doesn't fabricate) a credit for gaps with none available. Worth re-running periodically if Automation C's reliability is in question. |
| `npx tsx server/src/scripts/setKioskPassword.ts <identifier> <newPassword>` (run from `server/`) | Sets/rotates the shared kiosk-tablet login password — see `SPEC.md`'s "Auth" section. No in-app UI for this; it's a deliberate, rare operation. |
