# OZ Check-In

Student check-in tool for Oaktown Zouk. See [`SPEC.md`](./SPEC.md) for the full design
and the reasoning behind it.

```
server/   Fastify + TypeScript API, SQLite (Drizzle ORM)
web/      React + Vite front-desk SPA
```

> **Mid-migration note:** this app is being moved to Airtable (as the system of record,
> including the Givebutter sync) + Netlify Functions — see `SPEC.md` and the project's
> transition plan. Google Forms (waivers) and the direct Givebutter sync have already
> been removed from this codebase; what's described below is the interim state.

In production these run as **one process**: the server serves the built SPA as static
files. In development they run as two, with Vite proxying `/api` to the server.

## Prerequisites

- Node.js 22.5+ (uses the built-in `node:sqlite` module — see `SPEC.md` for why)
- npm

## Setup

```bash
npm install

cp server/.env.example server/.env
# edit server/.env — at minimum set SESSION_SECRET and CHECKIN_PASSWORD:
#   openssl rand -hex 32   # use the output for SESSION_SECRET

npm run db:generate   # generates SQL migration files from the schema (server/drizzle/)
npm run db:migrate    # applies them, creating server/data/oz-checkin.sqlite
```

At this point you can run the app fully locally with **sample data** and no API keys:

```bash
npm run seed          # wipes and repopulates the DB with sample students
npm run dev:server    # terminal 1 — API on :3000
npm run dev:web       # terminal 2 — SPA on :5173, proxying /api to :3000
```

Open http://localhost:5173, sign in with the `CHECKIN_PASSWORD` you set, and search.

There's currently no way to populate real payment/membership data locally other than
`npm run seed` — the Givebutter sync that used to do this has been removed as part of
the move to Airtable, which will become the new source of truth for that data (see the
transition plan). Until that lands, this app runs on whatever's already in
`server/data/oz-checkin.sqlite` plus manual seeding.

## Running for real

```bash
npm run build   # builds web/dist, then compiles server to server/dist
npm start       # runs the single production process, serving both API and SPA
```

This is one persistent Node process. Running it locally on a front-desk laptop (as
planned for the first few weeks) works the same way.

## Testing / manual verification — don't touch the real DB

`server/data/oz-checkin.sqlite` (the path in your real `server/.env`) holds real check-in
history once this is in use, with no external source of truth to recover it from if
wiped.

- For anything automatable, use `npm test` — it runs against an isolated in-memory DB
  (`.env.test`) and never touches a file on disk.
- For a manual/browser check against realistic data, use `npm run start:scratch` — reads
  `server/.env.scratch` (separate `DATABASE_PATH`, password, **and port — `:3001`, not
  `:3000`**) so a live check-in made while poking at the UI lands in a throwaway file,
  not the real one, and this process can never collide with (or get killed alongside) a
  real instance on `:3000`.
- Never run `rm`/reset against the path in the real `server/.env`.
- The real instance (`npm start`, port `:3000`) should be left running after a change is
  verified, so it's ready to try immediately at http://localhost:3000 without needing to
  start it yourself.
- **`npm run db:migrate` against the real `.env` is not always safe to run casually** —
  most schema changes are additive (`CREATE`/`ALTER ADD COLUMN`), but a migration can
  also `DROP` a table/column (e.g. the migration that removed `waivers`/`student_emails`
  as part of retiring Google Forms and the merge feature) — check what a generated
  migration actually does before applying it to the real database.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev:server` / `npm run dev:web` | Dev mode, two processes |
| `npm run watch` | Backend auto-restarts on save (`tsx watch`) + frontend auto-rebuilds on save (`vite build --watch`), together, serving on whichever `PORT`/`DATABASE_PATH` the active env points at — leave it running against the real `.env` instead of manually rebuilding after each change |
| `npm run build && npm start` | Production mode, one process |
| `npm run seed` | Reset local DB to sample data (dev only — never run against real check-in history) |
| `npm run typecheck` | Type-check both workspaces |
| `npm test` | Run the server unit tests (`node:test`, in-memory DB, dev DB never touched) |
| `npm run db:generate` | Regenerate migrations after changing `server/src/db/schema.ts` |
