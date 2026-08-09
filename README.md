# OZ Check-In

Student check-in tool for Oaktown Zouk. See [`SPEC.md`](./SPEC.md) for the full design
and the reasoning behind it.

```
server/   Fastify + TypeScript API, SQLite (Drizzle ORM), Google Forms / Givebutter sync
web/      React + Vite front-desk SPA
```

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

## Wiring up real data

Both integrations are optional independently — the server logs a warning and runs on
local data only if neither is configured. Leave either unset while you set up the other.

### Google Forms (waivers)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or
   reuse one), enable the **Google Forms API**, and create an OAuth client of type
   **Desktop app** under Credentials. Copy the client ID/secret into `server/.env` as
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. Set `GOOGLE_FORM_ID` in `.env` — it's the ID in the waiver form's edit URL:
   `forms.google.com/forms/d/<FORM_ID>/edit`.
3. Run `npm run google:auth --workspace server`, open the printed URL, sign in with the
   account that owns the waiver form, and approve access. It prints a
   `GOOGLE_REFRESH_TOKEN` line — add that to `.env` too.
4. Email is read from Google's built-in respondent-email field (`respondentEmail` on each
   response), not a form question — confirmed against the live OZ waiver form, which
   collects email that way (`emailCollectionType: RESPONDER_INPUT`) and has no "email"
   question at all. The "name" question is auto-detected by matching a question title
   containing "name" (case-insensitive) — on the live form this correctly finds the
   "Name" question. If your form's wording differs, or auto-detection picks the wrong
   question, set `GOOGLE_FORMS_NAME_QUESTION_ID` explicitly (and `GOOGLE_FORMS_EMAIL_QUESTION_ID`
   too, for the rarer case of a form using an actual email question instead of the
   built-in collection) — get question IDs from `GET https://forms.googleapis.com/v1/forms/<FORM_ID>`
   with your own OAuth token, or from the sync's error message if name auto-detection fails.

### Givebutter (payments)

1. In Givebutter, go to Account Settings → API and copy your API key into `.env` as
   `GIVEBUTTER_API_KEY`.

Field parsing in `server/src/services/givebutter.ts` is verified against real
`/contacts`, `/transactions`, and `/plans` responses from the OZ account (2026-08-08), not
guessed — see the comment at the top of that file for the specific findings (amounts are
dollars not cents, a recurring plan's charges carry that plan's `plan_id` and are excluded
from one-time credits so a membership renewal doesn't also look like a spare class pass,
and `next_bill_date` is the period-end signal for "is this membership active right now").

## Running for real (once data sources are wired up)

```bash
npm run build   # builds web/dist, then compiles server to server/dist
npm start       # runs the single production process, serving both API and SPA
```

This is one persistent Node process — the sync poller needs to keep running between
requests, so it needs somewhere that stays up (a small VPS, or a $0–7/mo host like
Fly.io / Railway / Render), not a serverless platform. Running it locally on a front-desk
laptop (as planned for the first few weeks) works the same way.

## Testing / manual verification — don't touch the real DB

`server/data/oz-checkin.sqlite` (the path in your real `server/.env`) holds real check-in
and merge history once this is in use — merges especially have no external source of
truth, so wiping that file loses them permanently; a resync will not bring them back.

- For anything automatable, use `npm test` — it runs against an isolated in-memory DB
  (`.env.test`) and never touches a file on disk.
- For a manual/browser check against realistic data, use `npm run start:scratch` — reads
  `server/.env.scratch` (same Forms/Givebutter credentials, since those are read-only
  pulls, but a separate `DATABASE_PATH`, password, **and port — `:3001`, not `:3000`**)
  so a live check-in or merge made while poking at the UI lands in a throwaway file, not
  the real one, and this process can never collide with (or get killed alongside) a real
  instance on `:3000`.
- Never run `rm`/reset/re-migrate against the path in the real `server/.env`.
- The real instance (`npm start`, port `:3000`) should be left running after a change is
  verified, so it's ready to try immediately at http://localhost:3000 without needing to
  start it yourself. `npm run db:migrate` against the real `.env` is fine when needed
  (schema migrations are additive — `CREATE`/`ALTER ADD COLUMN`, never `DROP`/`DELETE`)
  — that's a different thing from wiping the database file.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev:server` / `npm run dev:web` | Dev mode, two processes |
| `npm run watch` | Backend auto-restarts on save (`tsx watch`) + frontend auto-rebuilds on save (`vite build --watch`), together, serving on whichever `PORT`/`DATABASE_PATH` the active env points at — leave it running against the real `.env` instead of manually rebuilding after each change |
| `npm run build && npm start` | Production mode, one process |
| `npm run seed` | Reset local DB to sample data (dev only — never run against real check-in history) |
| `npm run typecheck` | Type-check both workspaces |
| `npm test` | Run the server unit tests (`node:test`, in-memory DB, no real API keys or dev DB touched) |
| `npm run db:generate` | Regenerate migrations after changing `server/src/db/schema.ts` |
