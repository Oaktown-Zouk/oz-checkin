# OZ Check-In — Spec & Design

Student check-in tool for Oaktown Zouk (OZ), a dance studio. A front-desk staffer
searches for a student, picks which class(es) they're checking into and as which role
(Lead/Follow), and taps to check them in — seeing tier/membership status and credit
balance at a glance. **Airtable is the system of record**, including Givebutter sync
(payments/memberships) — this app never talks to Givebutter directly. The server is a
thin layer of Netlify Functions that reads Airtable's computed fields and writes the
handful of things that are genuinely this app's own business logic.

> This is the second major version of the app. The first ran on Fastify + SQLite with
> its own polling sync against Google Forms (waivers) and Givebutter. That's gone —
> Google Forms/waivers were dropped as a product decision, and Airtable now owns the
> Givebutter sync. See the transition history in git log / the project's migration
> plan if you need the old architecture for context.

## Features

- **Check-in** against a searchable roster, with tier/access-status and credit-balance
  badges shown on each row.
- **Program + Role check-in**: front desk picks from that day's actively-scheduled
  classes (`Programs` — e.g. "Zouk L1", filtered to today's weekday/date range) and, for
  each one, whether the student is checking in as Lead or Follow. Multiple classes can
  be selected at once, creating one check-in record per {class, role} pair.
- **Tier-based access, computed by Airtable, not this app**: each member's `Tiers` →
  `Classes Per Day` determines how many check-ins are covered before a credit gets
  spent. The app reads Airtable's computed `Remaining Today`/`Access Status` rather
  than reimplementing that logic — a formula change in Airtable takes effect without a
  code deploy. See `docs/airtable-schema.md`.
- **Credits system**: a `Credits` table (granted on new-member signup, on a qualifying
  one-time Givebutter payment, or manually as a comp) gets auto-consumed by Airtable
  automations whenever a check-in exceeds the day's tier allowance, or flagged for
  front-desk review if none is available.
- **Dance level tracking** — a Lead level and a Follow level (1–4 or unset) per
  student, shown as small badges and editable inline.
- **Membership transfers** — move a Recurring Plan (membership) to a different student
  (e.g. someone bought a membership for a friend).
- **Backdating** — view and correct check-ins for a past day via an effective
  date/time picker. Creating a *new* check-in for a past day still works, but the
  tier-allowance/credit-consumption decision is computed by the app for that path
  specifically, since Airtable's live formulas only ever mean literal "today" — see
  "Check-in semantics" below.
- **Student detail pages** with a synthesized timeline (membership events, payments,
  credits granted, check-ins) and running stats.
- **Manual refresh** — no live cross-device push (Netlify Functions can't hold a
  connection open); a "Refresh" button re-fetches the roster.
- **Google OAuth login**, per-account roles (`Staff`/`Volunteer`/`Kiosk`) looked up in
  Airtable, stateless signed-cookie session.

## Scale & constraints

- ~1,000 students total, ~100 checked in on a typical class day.
- Multiple class days/programs are natively supported (`Programs`/`Weekdays`), not
  hardcoded to one weekday — a real scheduling model, not a UI-level gate like the old
  app's Thursday-only check.
- Runs as Netlify Functions (static SPA + serverless API) — free-tier friendly, no
  always-on process to keep alive, no local database.
- Solo/small-team operator, per-account Google OAuth (see "Auth" below) — every account
  needs an explicit role row in Airtable to get in at all.

## System of record: Airtable

Airtable holds everything: the member roster, Givebutter-synced payments/memberships,
this app's own tables (`Credits`, and fields it writes like `Check-ins.Undone At`), and
the class schedule (`Programs`/`Sessions`/`Events`). Airtable's own automations sync
Givebutter (contacts, transactions, recurring plans) independently of this app —
verified live and running (`Sync Log` table). **This app never calls the Givebutter
API.**

**Guiding principle:** read Airtable's *computed* fields (`Access Status`,
`Remaining Today`, `Available Credits`, `Classes Allowed`, `Is Active Membership`, …)
directly rather than reimplementing their logic in the server. A future formula edit in
Airtable (e.g. changing the drop-in credit expiry window) takes effect on next read,
with no code deploy.

Full table/field-level mapping (old-schema-to-Airtable history, and which fields to
read for what) lives in **`docs/airtable-schema.md`** — this file stays product/
architecture-level, that one is the technical schema reference.

## Credits system

The old app's "buy a pass, redeem it at check-in" model is now a first-class `Credits`
table, populated and consumed entirely by Airtable automations (not application code):

- **`Credits`** — `Member` (holder), `Purchased By` (payer, for a future transfer
  feature), `Reason` (`New Member` / `Drop-in Purchase` / `Comp`), `Source Transaction`,
  `Granted At`, `Consumed At`, `Consumed By Check-in`, `Available` (formula: true iff
  `Consumed By Check-in` is unlinked — this makes a credit self-heal if the check-in
  that consumed it is ever deleted directly in Airtable, not just undone through the
  app).
- **Automation A** grants a credit when a new `Members` record is created.
- **Automation B** grants a credit when a `Transactions` record qualifies as a
  drop-in purchase (succeeded, one-time, no plan).
- **Automation C** runs on every new `Check-ins` record whose `Checked In At` is
  literally today: if the member's `Remaining Today` (post-check-in) is negative, it
  consumes their oldest `Available` credit, or sets `Needs Review`/`Review Reason` on
  the check-in if none exists.
- **Automation D** runs whenever a `Check-ins` record's `Undone At` gets set: it frees
  any credit that check-in had consumed.

**Backdated check-in creation is the one place this app computes gating itself** —
Automation C only fires for same-day check-ins, since Airtable's live fields
(`Remaining Today`, the `Checked In Today (Live)` rollup) are hardcoded to literal
"today" and can't evaluate allowance for a past date. For a backdated check-in the
server counts that student's existing non-undone check-ins on the target date, compares
against their current `Classes Allowed`, and — mirroring Automation C exactly — either
does nothing, consumes the oldest available credit, or flags the check-in for review.
Undo needs no such split: Automation D already works for any date.

## Dance levels

Each student has an independent **Lead level** and **Follow level**, 1–4 or unset,
front-desk-set (`Members.Lead Level` / `Follow Level`). Displayed as small badges — a
blue square with the digit for Lead, a purple circle for Follow, gray when unset — at
the left edge of the badge row in both the check-in list and the student detail page.
Clicking either badge (or the corresponding stat box on the detail page) opens a picker
dialog. Unchanged from the previous version of this app.

## Check-in semantics

- **Program + Role, not a single "Check In" button.** Front desk opens the check-in
  picker, sees that day's active `Programs` (today, or the backdated date if viewing
  one), and for each program picks Lead or Follow (one or the other, not both —
  checking in as both requires two separate rows/submissions). Selecting several
  programs and submitting creates one `Check-ins` record per selection; each is
  independently gated (checking into 2 classes when the tier only allows 1/day
  correctly consumes/flags for the second one).
- **Programs are listed by start time** (`Programs.Start Time`), grouped with a divider
  between timeslots — classes sharing a slot sort alphabetically within it. Since a
  student can't be in two classes at once, picking a role for one class in a timeslot
  grays out and disables the Lead/Follow buttons for every other class in that same
  slot, until it's deselected again.
- **Preselected from the student's most recent visit** (`StudentStatus.
  lastCheckinSelections`, computed once per roster fetch, not per dialog-open) — the
  programs/roles they picked last time are checked by default, restricted to whichever
  of those programs are still on today's (or the backdated day's) active schedule.
  Deliberately not backdating-aware: always the true most recent visit, not "most
  recent as of the viewed date."
- **Program schedules are fetched once per session** (`GET /api/programs`, no date
  param — all `Status = Active` programs with their raw weekday/date-range/skip-date
  fields), not re-fetched every time the check-in picker opens. "Which programs are
  active for a given day" (`Status = Active`, that date's weekday in `Weekdays`, within
  `Start Date`/`End Date`, not in `Skip Dates` — comma-separated `YYYY-MM-DD`) is
  computed **client-side** against whichever date is currently relevant (live or
  backdated), so backdating re-filters instantly with no extra round-trip.
- **Access/credit gating is tier-based**, computed by Airtable (see "Credits system"
  above) — not the old app's "one free check-in per active membership."
- **Undo preserves history**: `Check-ins.Undone At` gets set rather than deleting the
  row. The daily count (`Members.Checked In Today (Live)`) is a *live rollup* of
  non-undone same-day check-ins, not a maintained counter — so it, and everything
  downstream of it (`Remaining Today`), self-corrects on undo automatically, and even
  self-heals if a check-in is ever deleted directly in Airtable rather than undone
  through the app.
- A student with `Needs Review` set on a check-in (beyond their allowance, no credit
  available) shows that inline on their row — front desk judgment call, same spirit as
  the old app's "no payment on file, confirm anyway" pattern (the picker still confirms
  before submitting in that case).

### Viewing and correcting past days

Front desk can set an **effective date & time** (a picker reached via "Backdate
check-ins," in the header, "live" by default) that affects both what the page shows and
what a new check-in gets stamped with:

- **View**: the roster — who's checked in, sort order — is scoped to the effective
  date instead of real today; the check-in picker shows that date's active Programs,
  not today's.
- **Check in**: while set, a new check-in's `Checked In At` is stamped with that value,
  and gating is computed by the app for that date specifically (see "Credits system").
- **Undo**: works identically regardless of date.
- Kept in the URL (`?effectiveAt=...`) so a forced refresh while backdating doesn't
  silently snap back to live — but not carried across a fresh page load without that
  query param. A yellow banner ("Viewing and Checking In for `<date>`") shows above the
  search bar the entire time it's set, with a "Return to live" link inside the banner.
- No guardrail on future dates.

## Membership transfers

A student can buy a Recurring Plan (membership) **for someone else** — Givebutter has
no concept of this. `Recurring Plans` already splits `Member` (raw Givebutter payer,
refreshed by sync) from `Covers Member` (who it's for, for access/display purposes);
transferring is just updating `Covers Member` to the new holder. Reached via the 3-dot
menu on a row, or a button on the student detail page. Credit transfers
(`Credits.Purchased By` exists in the schema for the same purpose) aren't built —
not requested yet.

## Permissions

Access is permission-based, not role-based — a role is just Airtable's way of
grouping permissions together, and every route/UI action checks a specific
permission, never a role name directly. Two tables drive this (full detail in
`docs/airtable-schema.md`):

- **`User Roles`** — Google account email → a linked `Role Permissions` row.
- **`Role Permissions`** — one row per role (`Staff`/`Volunteer`/`Kiosk`), a checkbox
  per permission: `View Student Data`, `Write Student Data`, `Create Checkins`,
  `Undo Checkins`, `Write Memberships`.

Resolved once at login and baked into the session cookie (see "Auth" below) — an
admin can tune what a role can do in Airtable without a code deploy, but a change
takes effect on that account's next login, not live. The frontend mirrors the same
permissions via a `PermissionsProvider` context (`web/src/permissions.ts`), so a role
missing a permission doesn't just get a 403 from the API — the corresponding button
never renders in the first place (e.g. no Undo link without `Undo Checkins`, no level-
edit badges without `Write Student Data`, no Transfer menu item without
`Write Memberships`). A session with no `View Student Data` can't reach the roster at
all — the frontend shows a "not authorized for this page" screen naming the signed-in
account instead.

## Architecture

```
┌───────────────────────────────────────────────┐
│ Netlify                                        │
│                                                 │
│  Static SPA (React/Vite build) ── served by ──▶│ Netlify CDN
│                                                 │
│  Netlify Functions (one Hono app, all routes)  │
│     ├─ auth (Google OAuth, logout, session)    │
│     ├─ GET  students                (roster)   │
│     ├─ PATCH students/:id/lead-level           │
│     ├─ PATCH students/:id/follow-level         │
│     ├─ GET  students/:id/timeline              │
│     ├─ GET  students/:id/memberships           │
│     ├─ POST students/:id/transfer-membership   │
│     ├─ GET  programs                           │
│     ├─ POST checkins                           │
│     └─ DELETE checkins/:id                     │
│              │                                 │
│              ▼                                 │
│         Airtable REST API (system of record)   │
└───────────────────────────────────────────────┘
```

- **Backend:** Hono, via its Netlify adapter (`hono/netlify`) — one function
  (`netlify/functions/api.mts`) handles the whole `/api/*` surface via Netlify
  Functions v2 path-based routing. Locally runs the same way under `netlify dev`, or
  standalone via `@hono/node-server` (`server/src/dev.ts`, `npm run dev`) for quicker
  iteration without the Netlify runtime.
- **Airtable client:** thin `fetch` wrapper (`server/src/airtable/client.ts`) — pagination,
  429 retry, no SDK dependency.
- **Frontend:** React + Vite SPA, hand-rolled routing (`window.history.pushState` + a
  `popstate` listener) — no router library, the app only has two "pages" (the roster
  and a student detail page). Built to static files (`web/dist`), served by Netlify's
  CDN.
- **Auth:** Google OAuth (authorization code flow, `server/src/routes/auth.ts`) — sign-in
  redirects to Google, the callback exchanges the code server-side and reads the
  account's email from Google's userinfo endpoint, then resolves it to a role and
  permission set via Airtable (`services/userAccess.ts`; see "Permissions" below). On
  success the app mints its own stateless HMAC-signed session cookie carrying
  `{ email, role, permissions }` (`server/src/lib/session.ts`) — no server-side
  session store (fits serverless) and no re-checking Airtable on every request.
  A dev-only escape hatch (`GET /api/auth/dev-login?email=`, gated behind
  `DEV_LOGIN_ENABLED=true` *and* `NODE_ENV !== "production"`, not just wired up
  conditionally so a single misconfigured var can't activate it in prod) mints a real
  session the same way, skipping Google's consent screen — useful for an agent or
  script to verify UI changes without a human present.
- **No cross-table transactions.** Airtable's API has no multi-table atomic write.
  Where a single logical action touches two records (e.g. a backdated check-in
  consuming a credit), the app writes them sequentially and accepts the rare
  partial-failure risk at this scale (~100 check-ins/week) rather than building
  compensating-transaction machinery.
- **Local dev env files:** `server/.env` (used by `npm run dev`, the plain
  `@hono/node-server` path) and a root-level `.env` (used by `netlify dev`, which has
  no concept of `server/.env`) both need `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`,
  `SESSION_SECRET`, `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — kept in
  sync manually, see `.env.example` at the repo root. `APP_ORIGIN` is the origin the
  *browser* sees, not necessarily the origin this process listens on — in two-terminal
  dev the browser talks to Vite on `:5173`, which proxies `/api` to this process on
  `:3000`, so `APP_ORIGIN` there is `http://localhost:5173`, not `:3000`. The OAuth
  client's "Authorized redirect URIs" need one entry per `APP_ORIGIN` value
  (`<APP_ORIGIN>/api/auth/google/callback`).

## API

All routes except `/api/auth/*`, `/api/logout`, `/api/session`, and `/health` require
a valid session holding the specific permission noted below (`requirePermission(...)`
middleware, `server/src/lib/auth.ts` — 401 if no session, 403 if the session's
permissions don't include the one that route needs). See "Permissions" above.

- `GET /health` — `{ ok: true }`, no auth required.
- `GET /api/auth/google/start` — redirects to Google's OAuth consent screen. Real
  browser navigation, not a fetch call.
- `GET /api/auth/google/callback` — exchanges the auth code, resolves the account's
  role/permissions via `User Roles`/`Role Permissions`, sets the session cookie if
  found, redirects to `/`. Redirects to `/?authError=not_authorized` (no matching
  `User Roles` row) or `/?authError=oauth_failed` (anything else going wrong) instead
  of setting a cookie.
- `GET /api/auth/dev-login?email=` — dev-only equivalent of the callback above, minus
  the Google round-trip. See "Auth" above for its gating.
- `POST /api/logout` — clears the session cookie.
- `GET /api/session` — `{ authenticated: boolean, email?, role?, permissions? }`.
- `GET /api/students?date=<YYYY-MM-DD>` — **View Student Data.** The full roster with
  computed status (`accessStatus`, `membershipStatus`, `tierName`, `classesAllowed`,
  `remaining`, `availableCredits`, `checkinsToday`, `checkedInToday`,
  `lastCheckinSelections` — see "Check-in semantics"). `date` defaults to today; 400 if
  malformed. No `q` param — the frontend fetches the unfiltered roster once and
  searches client-side, same as before.
- `GET /api/students/:id/timeline` — **View Student Data.** Synthesized event feed
  (membership started/status, payments, credits granted, check-ins) plus
  `totalCheckIns`/`mostRecentCheckInAt`. 404 if unknown id.
- `PATCH /api/students/:id/lead-level` `{ level }` — **Write Student Data.** `level` is
  `1`–`4` or `null`. 400 if invalid.
- `PATCH /api/students/:id/follow-level` `{ level }` — **Write Student Data.** Same
  shape.
- `GET /api/students/:id/memberships` — **View Student Data.** Recurring Plans
  currently held by this student (for the transfer picker).
- `POST /api/students/:id/transfer-membership` `{ planId, targetEmail }` — **Write
  Memberships.** Moves that Recurring Plan's `Covers Member` to the student found by
  `targetEmail`. 400 if missing fields; 404 if the plan or target student doesn't
  exist; 409 if the plan doesn't currently belong to `:id` or already belongs to the
  target.
- `GET /api/programs` — **Create Checkins.** All `Status = Active` Programs with their
  raw weekday/date-range/skip-date fields and `startTime` (`Programs.Start Time`,
  `"HH:mm"`), for the check-in picker to filter and sort client-side against whichever
  date is relevant (see "Check-in semantics"). Fetched once per session, not per
  picker open. Gated by `Create Checkins` rather than `View Student Data` since it's
  schedule data, not student data, and it's only ever consumed by the check-in flow.
- `POST /api/checkins` `{ studentId, selections: [{ programId, role }], effectiveAt? }`
  — **Create Checkins.** Creates one `Check-ins` record per selection. 400 if
  `studentId`/`selections` missing or malformed, or `effectiveAt` doesn't parse.
- `DELETE /api/checkins/:id` — **Undo Checkins.** Sets `Undone At` on that check-in.
  404 if unknown; 409 if already undone.

## Webpage (front desk view)

- Search bar (name), filters the already-fetched roster client-side.
- Rows: name · badges (dance levels, then either a membership-tier badge or a
  credits-remaining badge — never both, see "Tier Rule gaps" (under Members) in
  `docs/airtable-schema.md` for when a nominal member shows credits instead) · Check
  In button · 3-dot menu. Each of Check In/Undo/level-edit/Transfer only renders for a
  session with the matching permission (see "Permissions" above) — a lower-permission
  session simply doesn't see the control, not a disabled version of it.
- "Check In" opens the Program + Role picker (see "Check-in semantics"); once checked
  in, the button becomes "Check in to another class" and the row shows each check-in's
  time, class, and role, with an Undo link and a `Needs review` flag when applicable.
- Checked-in-today rows sink to the bottom, grayed out. Above that, students whose
  `Members."Recently Active"` (Airtable formula, 30-day window) is false sort below
  recently-active ones — see `docs/airtable-schema.md`.
- "Refresh" button, top of page — manual only, no live push (see Architecture).
- "Backdate check-ins" link in the header (hidden once a backdate is active, replaced
  by the picker) — see "Viewing and correcting past days" above.
- 3-dot (⋮) menu on each row: **Transfer membership** — dialog listing every Recurring
  Plan this student currently holds, plus a target email field.
- Student names link to `/students/:id` — see "Student detail page" below.

### Student detail page

`/students/:id` (`GET /api/students/:id/timeline`) — a history view reached by
clicking a name.

- Header: name, email, the same status badges as the list row (dance levels are
  clickable here too), and a "Transfer membership" button.
- Stat boxes: **most recent check-in** ("Never" if none), **total check-ins** (real
  ones only), and clickable **Lead Level** / **Follow Level** boxes (same picker
  dialog as the compact badges).
- A newest-first timeline synthesized from `Recurring Plans`, `Transactions`,
  `Credits`, and `Check-ins` for that student — not a stored event log. Event types:
  `membership_started`, `membership_status` (non-active statuses only), `payment` (one
  per held Transaction, labeled as membership payment or one-time pass by whether it
  carries a plan), `credit_granted`, `checkin`.
- Routing is hand-rolled — a direct load or reload of `/students/:id` lands back on
  that student's page, not the list.
