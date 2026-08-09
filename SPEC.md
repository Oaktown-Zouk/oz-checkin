# OZ Check-In — Spec & Design

Student check-in tool for Oaktown Zouk. A front-desk staffer (currently just Ben) searches
for a student and taps a button to check them in, seeing waiver and payment status at a glance.

## Scale & constraints

- ~1,000 students total, ~100 checked in on a typical day.
- Single studio, single check-in flow (no multi-session-per-day support needed).
- Runs locally on a front-desk laptop for v1; should be deployable to a cheap always-on
  host later without a rewrite.
- Solo operator for now, but design for basic auth from day one since remote/hosted
  access is a near-term goal.

## Data sources

| Source | What we pull | Access |
|---|---|---|
| Google Forms | Waiver form responses | OAuth2 (installed-app flow, one-time consent, refresh token stored server-side) — Forms API doesn't support service accounts for a personal Google account |
| Givebutter | Contacts, transactions, recurring plans | Bearer API key (account settings) |

**Sync strategy (v1): polling, not webhooks/watches.** Google Forms push notifications
require a Cloud Pub/Sub topic and a watch that expires weekly (needs a renewal job); Givebutter
webhooks require a public HTTPS endpoint. Neither is worth the setup cost while running
locally. Instead:

- Backend polls both APIs on an interval (default **10 min**, configurable via env var).
- A manual **"Refresh now"** button on the webpage triggers an immediate re-sync.
- The UI shows "last synced Xm ago" so staff know how fresh the data is.
- Polling uses incremental fetch where the API supports it (Forms `responses.list` with a
  `timestamp >` filter; Givebutter transactions/contacts fetched by `updated_at` where
  available) and upserts into SQLite, so this scales fine to 1k students on a laptop.
- **Upgrade path:** once hosted somewhere with a public URL, swap polling for a Forms
  Pub/Sub watch (+ weekly renewal cron) and Givebutter webhooks, triggering the same
  upsert functions the poller uses today. This is a swap of the *trigger*, not the sync
  logic itself.

## Identity: matching a person across three systems

**Email is the canonical match key**, normalized (lowercased, trimmed) before comparison.
Both Google Forms and Givebutter capture email, so a `students` table keyed by email is the
join point between waiver records, payment records, and check-in history. Name is stored for
display/search but never used to match identity.

*Verified against the live waiver form:* it has no "email" question — email comes from
Google's built-in respondent-email collection (`emailCollectionType: RESPONDER_INPUT`),
which the API exposes as a top-level `respondentEmail` field on each response, not as an
answer tied to a question ID. The sync code reads that field directly, with a fallback to
a titled "email" question for forms that don't use the built-in collection.

**Reality: the same person sometimes uses different emails for the waiver vs. Givebutter**
(e.g. a personal address on the form, a work address for payment) — confirmed against real
account data, where this affected several people. Since matching is per-email, sync creates
a separate `students` row per email the first time it's seen, so these show up as two rows:
one with a waiver and no payment, one with a payment and no waiver — and this doesn't
self-heal, since email-only matching has no way to know they're the same person.

**Fix: a `student_emails` table (one student → many emails) plus a manual "Merge info"
action.** Front desk finds the duplicate, opens the 3-dot menu on either row, and enters
the other row's email. The merge reassigns all of the absorbed student's records (waiver,
Givebutter contact/payments/memberships, check-in history) onto the surviving student,
links the absorbed email so future syncs recognize it as already-known instead of
recreating the duplicate, and deletes the absorbed row.

**Guardrail:** the only legitimate use is combining a Google-Forms-only student with a
Givebutter-only student — exactly one side has waiver data, the other has Givebutter data.
Merging two students that both already have a waiver, or both already have Givebutter data,
is blocked (409) — that pattern doesn't fit the "split identity" problem this feature
exists to fix, and merging anyway would silently combine two people's real, separate
history. "Has Givebutter on file" is checked across `givebutter_contacts`, `payments`, and
`memberships` (any one is sufficient); "has Forms on file" is a `waivers` row.

## Payment model

Givebutter supports both **one-time payments** and **recurring memberships**, and both are in
active use, so payment status isn't a single boolean — it's shown differently depending on type:

- **Active recurring membership** → green "Member" badge. Good for the current period;
  checking in does *not* consume anything.
- **One-time payments** → each successful transaction is a redeemable line item ("class
  credit"). Badge shows `N credits available`. Checking in **redeems the oldest unredeemed
  credit** by default (one click, no staff decision needed in the common case); an expandable
  row lets staff pick a specific payment to redeem instead, for the rare edge case.
- **Neither** (no active membership, no unredeemed credits) → red "No payment on file" badge.
  Check-in is still *allowed* — front desk makes the judgment call (e.g. cash payment
  happening right now that hasn't hit Givebutter yet) — but the badge makes the gap visible,
  and checking in shows a confirmation prompt ("No payment on file — check in anyway?").

Waiver status follows the same "flag, don't block" pattern: missing waiver shows a red badge
and a confirm-to-override, but never hard-blocks check-in.

## Check-in semantics

- Check-ins are scoped to a **day** (`YYYY-MM-DD`), not a session.
- **Recurring members:** capped at one check-in per day — a membership isn't consumed by
  checking in, so a second check-in the same day wouldn't do anything.
- **One-time-payment students: one check-in per unredeemed credit, per day.** A student who
  bought two passes can be checked in twice today (e.g. using one themselves and handing the
  other to a friend at the door) — each check-in redeems one credit, and the option to check
  in again stays available as long as unredeemed credits remain.
- Once a student has ≥1 check-in today, their row sorts to the **bottom of the list, grayed
  out**, showing each check-in time. If they're a one-time payer with remaining credits, a
  **"Use another pass"** action stays active on the (otherwise grayed) row.
- Each check-in is independently undoable same-day (mis-clicks happen at a front desk) — undo
  removes that specific check-in and, if it redeemed a credit, un-redeems that credit.
- History is retained indefinitely (`checkins` table keeps one row per redemption) — this is
  also the natural place to compute attendance stats later.

### Viewing and correcting past days

Front desk can set an **effective date & time** (a `datetime-local` picker in the header,
"live" — i.e. unset — by default) that affects both what the page shows and what a new
check-in gets stamped with:

- **View**: the whole page — who's checked in, sort order, the daily cap — is scoped to the
  effective date instead of the real today. This falls directly out of `checkins.date`
  already being a per-row field; it was always "correct" per day, the app just never asked
  for anything other than today's.
- **Check in**: while an effective date/time is set, a new check-in's `date` *and*
  `checked_in_at` (and a redeemed credit's `redeemed_at`) are stamped with that value, not
  the real now. This is how a missed check-in from three days ago gets corrected — set the
  time, check them in, return to live.
- Not persisted anywhere — it's in-memory UI state that resets to live on page reload. That's
  intentional: the risk of this feature is someone forgetting they're in the past and
  backdating today's real walk-ins by accident, so leaving it can't survive past "close the
  tab." A yellow banner ("Viewing and Checking In for `<date>`") is shown above the search
  bar the entire time it's set, impossible to miss.
- No guardrail on future dates — checking someone in "tomorrow" just isn't a thing that
  happens in practice, and if picked by accident the view is simply empty (harmless), so it
  wasn't worth adding friction for.

## Architecture

Single Node.js/TypeScript process for v1 — one deployable, no separate frontend host needed:

```
┌─────────────────────────────────────────────┐
│ Node process (Fastify)                       │
│                                               │
│  REST API  ── serves ──▶  React (Vite) SPA   │
│     │                     (built + served     │
│     │                      as static files)   │
│  Poller (node-cron, in-process interval)      │
│     │                                         │
│     ├──▶ Google Forms API (OAuth2)            │
│     └──▶ Givebutter API (API key)             │
│     │                                         │
│  SQLite (via Drizzle ORM)                     │
└─────────────────────────────────────────────┘
```

**Backend: Fastify + TypeScript.** Lightweight, low overhead, built-in schema validation —
a good fit for a small typed REST API. (Express would also work fine if you'd rather use
the more familiar option; the rest of this design doesn't depend on the choice.)

**DB: SQLite via Drizzle ORM.** Drizzle's schema syntax is (almost) identical across SQLite
and Postgres, so "migrate later" — which you flagged as likely — is a driver swap and a
`drizzle-kit` migration generation, not a rewrite. Driver is Node's built-in `node:sqlite`
(via `drizzle-orm/node-sqlite`, on Drizzle 1.0's release candidate), not `better-sqlite3` —
switched after `better-sqlite3`'s locally-compiled native binary (no prebuilt exists yet
for current Node versions) crashed the process under real load, a known class of issue on
recent Node majors. `node:sqlite` ships inside Node itself, so there's no separate native
module to get out of sync with the Node version.

**Frontend: React + Vite SPA**, built to static files and served by the same Fastify process.
Keeps deployment to one process/one port, which matters for "cheap to host" (a single small
VPS or a $0–7/mo host like Fly.io/Railway/Render all work — anywhere that runs a persistent
Node process, since the poller needs to keep running between requests, unlike serverless).

**Auth (v1):** a single shared-password gate — password in an env var, checked against a
login form, issuing a signed session cookie (`@fastify/secure-session` or similar). No user
accounts, no per-staff login yet. Cheap to extend to per-staff accounts later since the
session layer is already in place; not worth building multi-user auth for a one-person front
desk today.

## Data model

```
students          (id, email UNIQUE, name, phone, created_at, updated_at)
student_emails    (id, student_id FK, email UNIQUE, created_at, updated_at)
                  -- alternate emails linked by a merge; consulted alongside
                  -- students.email whenever sync resolves "who does this email belong to"
waivers           (id, student_id FK, form_response_id UNIQUE, signed_at, raw_json)
givebutter_contacts (id, student_id FK, givebutter_contact_id UNIQUE)
payments          (id, student_id FK, givebutter_transaction_id UNIQUE, amount_cents,
                    paid_at, redeemed_at NULL, redeemed_by_checkin_id NULL)
memberships       (id, student_id FK, givebutter_recurring_plan_id UNIQUE, status,
                    current_period_end NULL, started_at NULL, canceled_at NULL, updated_at)
                  -- started_at/canceled_at are Givebutter's real event timestamps
                  -- (start_at/canceled_at on the plan), distinct from our own
                  -- created_at/updated_at which only reflect when *we* last synced —
                  -- these are what the student timeline's events are built from
checkins          (id, student_id FK, date, checked_in_at, checked_in_by,
                    payment_id NULL FK, undone_at NULL)
                  -- no unique(student_id, date): one-time payers can have multiple rows
                  -- per day (one per redeemed credit); recurring members are capped at
                  -- one per day by application logic, not a DB constraint
sync_state        (source PK: 'google_forms' | 'givebutter', last_synced_at, cursor)
```

`students` rows are created/updated by the sync jobs (upsert on email) from whichever source
sees a person first — a Forms respondent with no Givebutter record yet still shows up as
"waiver signed, no payment," and vice versa.

## API

- `GET /api/students?q=<search>&date=<YYYY-MM-DD>` — list with computed waiver/payment/checkin
  status, filtered server-side by name. `date` defaults to today; 400 if malformed.
- `POST /api/checkins` `{ studentId, paymentId?, effectiveAt? }` — check in for today (or for
  `effectiveAt`'s day if given, an ISO datetime — see "Viewing and correcting past days"
  above); auto-selects oldest unredeemed credit if the student is a one-time payer and
  `paymentId` isn't given. 400 if `effectiveAt` doesn't parse. Rejected (409) if: this
  student already has a check-in that day and can't spend a credit for another, or a
  one-time payer has no unredeemed credits left.
- `DELETE /api/checkins/:id` — undo that specific check-in (and un-redeem its payment, if any).
- `POST /api/students/:id/merge` `{ otherEmail }` — merge the student found by `otherEmail`
  into `:id`. 404 if no student has that email; 409 if it's the same student or the
  source-collision guardrail blocks it (see "Identity" above).
- `POST /api/sync` — trigger an immediate Forms + Givebutter refetch.
- `GET /api/sync/status` — last-synced timestamps per source, for the "synced Xm ago" UI.
- `POST /api/login` / `POST /api/logout` — session auth.
- `GET /api/events` — Server-Sent Events stream (see "Live updates" below).
- `GET /api/students/:id/timeline` — see "Student detail page" below. 404 if unknown id.

## Webpage (front desk view)

- Search bar (name), debounced, filters the list client-side or via `?q=`.
- Rows: name · waiver badge · payment badge (membership or credit count) · Check In button.
- Checked-in-today rows sink to the bottom, grayed out, listing each check-in time + Undo.
  One-time payers with remaining credits keep an active "Use another pass" button on the
  grayed row; recurring members and fully-redeemed one-time payers don't.
- Missing waiver / no payment → red badge; check-in still works but confirms first. A
  blue "New Member" badge shows for anyone who's never actually checked in before
  (any date, all-time — `StudentStatus.everCheckedIn`), independent of payment or
  membership status — a heads-up to be extra welcoming, separate from the free
  first-time-drop-in promo (which is specifically "no payment + never checked in," and
  only changes the confirm-dialog wording, not the badges).
- "Last synced Xm ago" + manual Refresh button, top of page.
- 3-dot (⋮) menu on each row → **Merge info** — opens a dialog to enter another email
  address and merge that student's records into this row. Errors (blocked guardrail, no
  matching student) show inline in the dialog. A merged row's linked emails show under
  the primary one so front desk can see why a row combines a waiver and a payment.
- `datetime-local` picker in the header, empty ("live") by default — set it to view and
  check in against a past day. A yellow banner ("Viewing and Checking In for `<date>`")
  appears above the search bar the whole time it's set; a "Return to live" button clears
  it. Resets to live on page reload — never persisted.
- Student names link to `/students/:id` — see "Student detail page" below.

### Live updates

One Server-Sent Events connection per open tab (`GET /api/events`, `EventSource` on the
frontend — auto-reconnects on its own, no client-side retry logic needed):

- The backend calls `broadcastChange()` (`server/src/lib/events.ts`) after any real write
  — check-in, undo, merge, or a sync landing (cron tick or the manual "Refresh now"
  button both funnel through `runSync()`, so one call covers both) — fanning a `changed`
  event out to every connected tab, which triggers a re-fetch of the student list and
  sync status. This is what makes multiple front-desk devices (a real near-term plan, not
  just a today concern) see each other's check-ins without a manual refresh.
- The first event on every connection — including reconnects — is a random id generated
  once at process boot. The frontend compares it to what it already knows: same id on
  reconnect means the connection merely blipped (nothing to do); a different id means the
  backend process actually restarted, so it hard `location.reload()`s to pick up any new
  frontend build too, instead of running a stale bundle indefinitely. `GET /health` also
  exposes this id as a plain ops health-check convenience, independent of the frontend.
- No payload beyond a debug-friendly reason string — at this app's scale (~1k students) a
  full re-fetch is cheap enough that there's no reason to diff and ship what changed.

### Student detail page

`/students/:id` (`GET /api/students/:id/timeline`) — a read-only history view, reached by
clicking a name. No check-in actions here; it's for looking someone up, not acting on them.

- Header: name, email, alternate emails, and the same status badges as the list row.
- Three stats: **first registered** (earliest of any waiver signature, payment, or
  membership start — whichever source saw this person first), **most recent check-in**
  ("Never" if none), **total check-ins** (real ones only — undone check-ins don't count,
  same as `everCheckedIn`).
- A newest-first timeline synthesized from four sources, not a stored event log:
  - **Membership started** — `memberships.started_at` (Givebutter's real start date; falls
    back to our own `created_at` if a plan predates that column existing).
  - **Membership `<status>`** — whenever a membership's status isn't `"active"`, labeled
    with Givebutter's actual status word (verified real value: `"paused"`) rather than
    guessing "paused" vs "cancelled" — we don't have full certainty on every value it can
    take. Timestamped with `canceled_at` if Givebutter gave us one, else our own
    `updated_at` (the last time we noticed the status had changed) as a best effort.
  - **One-time pass purchased** — one per `payments` row, with the dollar amount.
  - **Checked in** — one per non-undone `checkins` row.
- Routing is hand-rolled (`window.history.pushState` + a `popstate` listener in `App.tsx`),
  not a router library — the app only ever has two "pages." The backend's catch-all
  static-file fallback (any non-`/api` 404 serves `index.html`) already handled arbitrary
  paths correctly before this existed, so a direct load or reload of `/students/:id` — the
  live-updates reload included — lands back on that student's page, not the list, without
  any special-casing beyond parsing the route from the URL once on mount.

## Open items to confirm before/while building

1. ~~Confirm the live waiver form actually has an email question~~ — verified: it doesn't;
   uses `respondentEmail`. Handled.
2. ~~Confirm Givebutter recurring-plan objects expose enough to compute "active this
   period"~~ — verified against real account data (2026-08-08): plans expose
   `next_bill_date` directly. Also found and handled a real edge case while checking:
   a recurring plan's charge transactions carry that plan's `plan_id` and must be
   excluded from one-time "credits" — otherwise a member's monthly charge would also
   look like a spare class pass.
3. Decide the shared-password auth secret storage (plain env var is fine for v1 given the
   threat model, but flag if you want something stronger before going remote).
