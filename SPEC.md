# OZ Check-In — Spec & Design

Student check-in tool for Oaktown Zouk (OZ), a dance studio. A front-desk staffer searches
for a student and taps a button to check them in, seeing waiver status, payment status,
and dance level at a glance — synced automatically from Google Forms (waivers) and
Givebutter (payments/memberships).

## Features

- **Check-in** against a searchable roster, with waiver / membership / credit status shown
  as badges on each row.
- **Automatic sync** from Google Forms (waiver signatures) and Givebutter (one-time
  payments, recurring memberships, and the monthly charges billed against them), on a
  timer plus a manual "Refresh now" button.
- **Payment-aware check-in logic**: an active (or recently-paused-but-paid) membership
  covers a check-in for free; a one-time payer redeems the oldest unredeemed credit;
  someone with neither still gets checked in, with a confirmation prompt.
- **One free drop-in credit** automatically granted to every new student.
- **Dance level tracking** — a Lead level and a Follow level (1–4 or unset) per student,
  shown as small badges and editable inline.
- **Duplicate-record merging** — combine a student's Google-Forms-only record with their
  Givebutter-only record when they used different emails for each.
- **Membership/credit transfers** — move a specific membership or unredeemed one-time
  credit to a different student (e.g. someone bought a membership for a friend), while
  preserving who actually paid for display on both sides.
- **Backdating** — view and correct check-ins for a past day via an effective date/time
  picker, without affecting "live" (today's) state.
- **Class-day gating** — the check-in button is disabled on any day OZ doesn't teach class.
- **Student detail pages** with a synthesized timeline (registration, membership events,
  payments, check-ins) and running stats.
- **Live updates** across every open tab via Server-Sent Events — no polling, no manual
  refresh needed after another device's action.
- **Single shared-password auth**, session-cookie based.

## Scale & constraints

- ~1,000 students total, ~100 checked in on a typical (Thursday) class day.
- Single studio, single weekly class day — check-in is only enabled on Thursdays (the only
  day OZ currently teaches), though this is a UI-level gate, not a hard server rule.
- Runs locally on a front-desk laptop today; deployable to a cheap always-on host without a
  rewrite (see Architecture).
- Solo/small-team operator, shared-password auth (no per-staff accounts yet).

## Data sources

| Source | What we pull | Access |
|---|---|---|
| Google Forms | Waiver form responses | OAuth2 (installed-app flow, one-time consent, refresh token stored server-side) |
| Givebutter | Contacts, one-time transactions, recurring plans (and the charges billed against them) | Bearer API key (account settings) |

**Sync strategy: polling, not webhooks/watches.** Both are optional independently — the
server logs a warning and runs on local data only if neither is configured.

- Backend polls both APIs on an interval (default **10 min**, `SYNC_INTERVAL_MINUTES`), plus
  once ~2s after boot.
- A manual **"Refresh now"** button (`POST /api/sync`) triggers an immediate re-sync;
  concurrent triggers (a cron tick landing mid-manual-refresh) are coalesced into one run.
- The UI shows "synced Xm ago" per source.
- Google Forms uses incremental fetch (`responses.list` with a `timestamp >` cursor stored
  in `sync_state`). Givebutter re-fetches contacts/transactions/plans in full each run —
  there's no incremental cursor for those endpoints; upserts make this idempotent.

### Google Forms details

- Email comes from Google's built-in respondent-email collection
  (`response.respondentEmail`), not a form question — verified against the live OZ waiver
  form, which has no "email" question at all. Falls back to a titled "email" question
  (`GOOGLE_FORMS_EMAIL_QUESTION_ID` override available) for forms that don't use built-in
  collection.
- The "name" question is auto-detected by title match (case-insensitive "name"); override
  with `GOOGLE_FORMS_NAME_QUESTION_ID` if auto-detection picks the wrong question.
- Each response becomes a `waivers` row (deduped by `form_response_id`).

### Givebutter details

Field parsing is verified against real `/contacts`, `/transactions`, and `/plans`
responses from the OZ account, not guessed:

- **Every contact becomes a student**, not just ones with a payment or plan — this is what
  lets front desk add someone in Givebutter (e.g. a contact who hasn't paid yet and is
  going to use their free drop-in credit instead) and have them show up on the roster with
  no payment required first. Contacts without a resolvable email are skipped.
- Amounts are plain dollar floats (e.g. `95`), not cents — converted to cents on ingest.
- A transaction carries `plan_id` when it's the initial or renewal charge of a recurring
  plan. Those become `membership_charges` rows (history), **not** a redeemable one-time
  credit — otherwise a member's monthly charge would also look like a spare class pass.
  Only `plan_id == null` transactions become `payments` rows.
- Plans expose `next_bill_date`, used as the "current period end" signal for whether a
  membership is active right now.
- Pagination is Laravel-style `{ data, links, meta }`.

## Identity: matching a person across three systems

**Email is the canonical match key**, normalized (lowercased, trimmed). A `students` table
keyed by email is the join point between waiver records, payment records, and check-in
history.

**Reality: the same person sometimes uses different emails** for the waiver vs. Givebutter
(personal address on the form, work address for payment). Sync creates a separate
`students` row per email the first time it's seen — this doesn't self-heal on its own.

**Fix: a `student_emails` table (one student → many emails) plus a manual "Merge info"
action.** Front desk finds the duplicate, opens the 3-dot menu on either row, and enters
the other row's email. The merge reassigns all of the absorbed student's records (waiver,
Givebutter contact, payments, memberships, membership charges, check-ins, and any
unclaimed promo credit) onto the surviving student, links the absorbed email so future
syncs recognize it as already-known, and deletes the absorbed row.

**Guardrail:** the only legitimate use is combining a Google-Forms-only student with a
Givebutter-only student — exactly one side has waiver data, the other has Givebutter data
(checked via `holder_student_id` on payments/memberships, so a student who currently holds
a *transferred* item counts as "has Givebutter" too). Merging two students that both
already have a waiver, or both already have Givebutter data, is blocked (409).

**Promo credits are one-per-reason per student**: if both sides of a merge already have a
grant for the same reason (e.g. both independently got the "new_student" freebie before
anyone noticed they're the same person), the absorbed side's duplicate is dropped rather
than kept — a merge shouldn't double up a one-per-student freebie.

**Name source priority:** Givebutter names are payment-processor-verified (checked against
a real credit card); Google Forms names are free text. Once a name has been set by a
Givebutter sync, a later Forms sync — or a merge — cannot downgrade it. `students.name_source`
tracks which source last set the name.

## Payment model

Givebutter supports both **one-time payments** and **recurring memberships**, both in
active use:

- **Active recurring membership** → green "Member" badge. Good for the current period;
  checking in does *not* consume anything.
- **Paused (or otherwise non-active) membership, paid within the last 30 days** → gray
  "Member (paused, paid <date>)" badge — still covers check-in. Pausing doesn't
  retroactively revoke a month already paid for, so this grace period is checked against
  `membership_charges` history (the individual monthly charges), not the membership row
  alone. A membership older than 30 days unpaid, or with no charge history at all, shows
  **red** instead and does *not* cover check-in.
- **One-time payments** (and the automatic new-student credit — see below) → each is a
  redeemable "credit". Badge shows `N credits available` (hidden once a membership already
  covers the check-in, to avoid showing irrelevant info). Checking in **redeems the oldest
  unredeemed credit** by default; an explicit `paymentId` lets a specific one be chosen
  instead (server-side capability; not currently exposed in the UI, which always
  auto-selects).
- **Neither** → red "No payment on file" badge. Check-in is still *allowed* with a confirm
  prompt — front desk makes the judgment call.

Waiver status follows the same "flag, don't block" pattern.

### New-student promo credit

Every brand-new student (first time seen by either sync source) is automatically granted
one free drop-in credit (`promo_credits`, `reason = "new_student"`). It spends through the
exact same check-in flow as a real payment — auto-picked as the oldest unredeemed credit
(promo credits and real payments are compared by grant/purchase date; the older one wins).
It's a separate table from `payments` rather than a synthetic $0 transaction, since a
promo credit isn't real Givebutter money and mixing them would make revenue-style queries
against `payments` wrong.

### Membership/credit transfers

A student can buy a membership or a one-time pass **for someone else** (e.g. one for
themselves, one for a partner) — Givebutter has no concept of this, so both would
otherwise land on the buyer's own record. Front desk can transfer a specific item via the
3-dot menu ("Transfer membership/credit") or a button on the student detail page:

- Every `payments` and `memberships` row (and, by extension, `membership_charges`) has
  both a `student_id` (the raw Givebutter-attributed payer — refreshed freely by sync,
  never touched by app logic) and a `holder_student_id` (who it belongs to for
  check-in/display purposes — starts equal to `student_id`, changed only by an explicit
  transfer, never touched by sync once set for an existing row).
- Transferring a membership immediately re-points its existing `membership_charges`
  history too, and future charges synced for that plan automatically inherit the plan's
  *current* holder (looked up from `memberships.holder_student_id` at sync time) rather
  than re-deriving from the transaction's own Givebutter contact.
- Only unredeemed one-time credits can be transferred (nothing to move once spent).
- **Visible on both sides**: the holder sees "Member ... · paid by Alice" / "Membership
  payment, paid by Alice" in their timeline; the original payer sees "Paid for Bob's
  membership ($X)" as its own timeline event, so the transfer doesn't just look like the
  membership silently vanished from their history.
- A merge moves `student_id` and `holder_student_id` independently for the absorbed
  student's rows (two separate updates), correctly handling a student who was mid-transfer
  on either side at the time of the merge.

## Dance levels

Each student has an independent **Lead level** and **Follow level**, 1–4 or unset,
front-desk-set (not sourced from either sync). Displayed as small badges — a blue square
with the digit for Lead, a purple circle for Follow, gray when unset — at the left edge of
the badge row in both the check-in list and the student detail page. Clicking either badge
(or the corresponding stat box on the detail page) opens a picker dialog.

## Check-in semantics

- Check-ins are scoped to a **day** (`YYYY-MM-DD`), not a session.
- **Members** (active, or paused-but-recently-paid): capped at one check-in per day —
  nothing is consumed, so a second check-in the same day wouldn't do anything.
- **Credit-based check-ins**: one check-in per unredeemed credit, per day. A student with
  two credits (real or promo) can be checked in twice — each check-in redeems one credit,
  and a **"Use another pass"** action stays available on the (grayed, already-checked-in)
  row as long as unredeemed credits remain.
- Once a student has ≥1 check-in today, their row sorts to the bottom, grayed out, showing
  each check-in time + Undo. Undo removes that specific check-in and un-redeems whatever
  credit (real or promo) it spent, if any.
- History is retained indefinitely (`checkins` keeps one row per redemption, `undone_at`
  marks corrections rather than deleting them).
- **Class-day gating**: the Check In / Use another pass buttons are disabled (grayed, with
  a tooltip) whenever the viewed date isn't a Thursday — OZ's only class day. This is a
  frontend-only gate; the backend API doesn't reject check-ins for other days.

### Viewing and correcting past days

Front desk can set an **effective date & time** (a picker reached via "Backdate
check-ins," in the header, "live" by default) that affects both what the page shows and
what a new check-in gets stamped with:

- **View**: the whole page — who's checked in, sort order, the daily cap — is scoped to
  the effective date instead of real today.
- **Check in**: while set, a new check-in's `date`, `checked_in_at`, and any redeemed
  credit's `redeemed_at` are stamped with that value.
- Kept in the URL (`?effectiveAt=...`) so a forced refresh while backdating doesn't
  silently snap back to live — but not carried across a fresh page load without that query
  param. A yellow banner ("Viewing and Checking In for `<date>`") shows above the search
  bar the entire time it's set, with a "Return to live" link inside the banner.
- No guardrail on future dates.

## Architecture

Single Node.js/TypeScript process: one deployable, no separate frontend host needed.

```
┌─────────────────────────────────────────────┐
│ Node process (Fastify)                       │
│                                               │
│  REST API  ── serves ──▶  React (Vite) SPA   │
│     │                     (built + served     │
│     │                      as static files)   │
│  SSE (/api/events) ── pushes changes to tabs  │
│  Poller (node-cron, in-process interval)      │
│     │                                         │
│     ├──▶ Google Forms API (OAuth2)            │
│     └──▶ Givebutter API (API key)             │
│     │                                         │
│  SQLite (via Drizzle ORM, node:sqlite)        │
└─────────────────────────────────────────────┘
```

- **Backend:** Fastify + TypeScript.
- **DB:** SQLite via Drizzle ORM (`drizzle-orm/node-sqlite`, Drizzle 1.0-rc), on Node's
  built-in `node:sqlite` — not `better-sqlite3`, which crashed under real load due to its
  locally-compiled native binary. `node:sqlite` ships inside Node itself.
- **Frontend:** React + Vite SPA, hand-rolled routing (`window.history.pushState` + a
  `popstate` listener) — no router library, since the app only has two "pages" (the roster
  and a student detail page). Built to static files, served by the same Fastify process.
- **Auth:** a single shared-password gate (`CHECKIN_PASSWORD` env var), issuing a signed
  session cookie via `@fastify/secure-session`. No per-staff accounts yet.
- **Graceful shutdown:** SIGTERM/SIGINT drains SSE clients, closes the Fastify app, then
  explicitly closes the SQLite connection — needed so a fast restart (dev-watch, a
  redeploy) doesn't hit "database is locked" from a lock the OS hasn't released yet
  (`node:sqlite`'s busy timeout defaults to 0, no automatic retry).

## Data model

```
students            (id, email UNIQUE, name, name_source NULL, phone NULL,
                      lead_level NULL, follow_level NULL, created_at, updated_at)
                     -- name_source: 'google_forms' | 'givebutter' | NULL — which source
                     -- last set `name`; Givebutter (payment-verified) can't be downgraded
                     -- by a later Forms sync. lead_level/follow_level: 1-4 or NULL,
                     -- front-desk-set, independent of either sync.

student_emails       (id, student_id FK, email UNIQUE, created_at, updated_at)
                     -- alternate emails linked by a merge; consulted alongside
                     -- students.email whenever sync resolves "who does this email belong to"

waivers              (id, student_id FK, form_response_id UNIQUE, signed_at, raw_json,
                       created_at, updated_at)

givebutter_contacts  (id, student_id FK, givebutter_contact_id UNIQUE, created_at, updated_at)
                     -- always the raw Givebutter contact->student mapping, unaffected by
                     -- transfers (see holder_student_id below)

payments             (id, student_id FK, holder_student_id FK NULL,
                       givebutter_transaction_id UNIQUE, amount_cents, paid_at,
                       redeemed_at NULL, redeemed_by_checkin_id NULL, created_at, updated_at)
                     -- a one-time "class credit". student_id = the raw Givebutter payer
                     -- (refreshed by sync, never touched by app logic); holder_student_id
                     -- = who it's redeemable for right now (starts equal to student_id;
                     -- changed only by a transfer — see services/transfers.ts)

memberships          (id, student_id FK, holder_student_id FK NULL,
                       givebutter_plan_id UNIQUE, status, frequency NULL, amount_cents NULL,
                       current_period_end NULL, started_at NULL, canceled_at NULL,
                       created_at, updated_at)
                     -- status is the raw Givebutter string (e.g. "active", "paused").
                     -- started_at/canceled_at are Givebutter's real event timestamps,
                     -- distinct from our own created_at/updated_at (sync-touch times) —
                     -- these feed the student timeline. student_id/holder_student_id
                     -- split as in payments, above.

membership_charges   (id, student_id FK, holder_student_id FK NULL, givebutter_plan_id,
                       givebutter_transaction_id UNIQUE, amount_cents, paid_at,
                       created_at, updated_at)
                     -- history of charges billed against a plan (initial + every
                     -- renewal) — NOT a redeemable credit; the matching memberships row
                     -- already represents access. Exists so front desk can see when a
                     -- (possibly paused) member last actually paid. holder_student_id is
                     -- copied from the parent membership's CURRENT holder at sync time
                     -- (not re-derived from the transaction's own contact), so a
                     -- transferred membership's charges — past and future — follow it.

promo_credits        (id, student_id FK, reason, granted_at, redeemed_at NULL,
                       redeemed_by_checkin_id NULL, created_at, updated_at)
                     -- non-Givebutter redeemable credit, e.g. "new_student". UNIQUE
                     -- (student_id, reason) — one grant per reason per student. No
                     -- holder/payer split — always personal to the student it was
                     -- granted to, not Givebutter-sourced.

checkins             (id, student_id FK, date, checked_in_at, checked_in_by NULL,
                       payment_id NULL, promo_credit_id NULL, undone_at NULL)
                     -- no unique(student_id, date): credit-based check-ins can have
                     -- multiple rows per day (one per redeemed credit); membership-based
                     -- check-ins are capped at one per day by application logic, not a DB
                     -- constraint. payment_id/promo_credit_id are mutually exclusive —
                     -- at most one is set, depending on which kind of credit was spent.

sync_state           (source PK: 'google_forms' | 'givebutter', last_synced_at, cursor NULL)
```

`students` rows are created/updated by the sync jobs (upsert on email) from whichever
source sees a person first, plus by the merge action (which never creates new students,
only reassigns/deletes). Every new `students` row gets a `promo_credits` grant at creation.

## API

All routes except `/api/login`, `/api/logout`, `/api/session`, and `/health` require an
authenticated session (`requireAuth` — 401 if missing).

- `GET /health` — `{ ok: true, bootId }`, no auth required. `bootId` is a random UUID
  generated once per process start.
- `POST /api/login` `{ password }` — checks against `CHECKIN_PASSWORD`; sets the session
  cookie. 401 on wrong password.
- `POST /api/logout` — clears the session.
- `GET /api/session` — `{ authenticated: boolean }`.
- `GET /api/events` — Server-Sent Events stream (see "Live updates" below).
- `GET /api/students?date=<YYYY-MM-DD>&q=<search>` — the full roster with computed
  waiver/membership/credit/check-in status. `date` defaults to today; 400 if malformed.
  `q` still does a server-side name filter but the current frontend never sends it — it
  fetches the unfiltered roster once and searches client-side instead, to avoid a
  round-trip per keystroke once the server isn't on the same machine as the browser (see
  "Webpage" below).
- `GET /api/students/:id/timeline` — see "Student detail page" below. 404 if unknown id.
- `PATCH /api/students/:id/lead-level` `{ level }` — `level` is `1`-`4` or `null`. 400 if
  invalid.
- `PATCH /api/students/:id/follow-level` `{ level }` — same shape as lead-level.
- `POST /api/students/:id/merge` `{ otherEmail }` — merge the student found by
  `otherEmail` into `:id`. 404 if no student has that email; 409 if it's the same student
  or a guardrail blocks it (see "Identity" above).
- `POST /api/students/:id/transfer-item` `{ kind: "membership" | "payment", itemId,
  targetEmail }` — move that membership or unredeemed credit from `:id` to the student
  found by `targetEmail`. 400 if `kind`/`itemId`/`targetEmail` missing or malformed; 404 if
  the item or target student doesn't exist; 409 if the item doesn't currently belong to
  `:id`, already belongs to the target, or (for a payment) is already redeemed.
- `POST /api/checkins` `{ studentId, paymentId?, effectiveAt? }` — check in for today (or
  `effectiveAt`'s day). Auto-selects the oldest unredeemed credit (real or promo) if the
  student isn't covered by a membership and `paymentId` isn't given. 400 if `effectiveAt`
  doesn't parse. 409 if already checked in that day with nothing left to spend, an explicit
  `paymentId` doesn't belong to the student, or it's already redeemed.
- `DELETE /api/checkins/:id` — undo that specific check-in, un-redeeming whatever credit
  (real or promo) it spent, if any.
- `POST /api/sync` — trigger an immediate Forms + Givebutter refetch. Concurrent triggers
  are coalesced.
- `GET /api/sync/status` — `{ google_forms, givebutter }` last-synced ISO timestamps (or
  `null`), for the "synced Xm ago" UI.

## Webpage (front desk view)

- Search bar (name), filters the already-fetched roster client-side — no server round-trip
  per keystroke, which matters once the server isn't on the same machine as the browser.
- Rows: name · badges (dance levels, waiver, membership/credits, "No payment on file" if
  neither, blue "New Member" if never checked in before) · Check In button.
- Checked-in-today rows sink to the bottom, grayed out, listing each check-in time + Undo.
  Credit-based students with remaining credits keep an active "Use another pass" button on
  the grayed row.
- Missing waiver / no payment → red badge; check-in still works but confirms first via a
  browser `confirm()` dialog.
- "Synced Xm ago" (per source) + manual Refresh button, top of page.
- 3-dot (⋮) menu on each row:
  - **Merge info** — dialog to enter another email address and merge that student's
    records into this row. Errors show inline.
  - **Transfer membership/credit** — dialog listing every membership/unredeemed-credit
    this student currently holds, plus a target email field.
- "Backdate check-ins" link in the header (hidden once a backdate is active, replaced by
  the picker) — see "Viewing and correcting past days" above.
- Student names link to `/students/:id` — see "Student detail page" below.

### Live updates

One persistent Server-Sent Events connection per open tab (`GET /api/events`):

- The backend calls `broadcastChange(reason)` (`server/src/lib/events.ts`) after any real
  write — check-in, undo, merge, transfer, a dance-level edit, or a sync landing (cron
  tick or manual "Refresh now," both through `runSync()`) — fanning a `changed` event out
  to every connected tab, which triggers a re-fetch. This is what lets multiple front-desk
  devices see each other's actions without a manual refresh.
- The first event on every connection (including reconnects) is `bootId`, generated once
  at process boot. The frontend compares it to what it already knows: same id on
  reconnect means the connection merely blipped; a different id means the backend process
  actually restarted, triggering `location.reload()` to pick up any new frontend build.
- No payload beyond a debug-friendly reason string — at this app's scale a full re-fetch
  is cheap enough that there's no reason to diff and ship what changed.

### Student detail page

`/students/:id` (`GET /api/students/:id/timeline`) — a history view reached by clicking a
name.

- Header: name, email, alternate emails, the same status badges as the list row (dance
  levels are clickable here too), and a "Transfer membership/credit" button.
- Stat boxes: **first registered** (earliest of any waiver signature, payment, or
  membership start), **most recent check-in** ("Never" if none), **total check-ins** (real
  ones only), and clickable **Lead Level** / **Follow Level** boxes (same picker dialog as
  the compact badges).
- A newest-first timeline synthesized from these sources (not a stored event log):
  - **Membership started** — `memberships.started_at` (falls back to our own `created_at`).
  - **Membership `<status>`** — whenever status isn't `"active"`, labeled with Givebutter's
    actual status word. Timestamped with `canceled_at` if given, else our own `updated_at`.
  - **Membership payment** — one per `membership_charges` row this student holds, noting
    "paid by `<name>`" when the payer differs from the holder (a transfer).
  - **Paid for `<name>`'s membership** — the payer's-side view of a transferred
    membership's charges (so it's visible on both pages, not just the recipient's).
  - **One-time pass purchased** (or "received from `<name>`" if transferred in) — one per
    held `payments` row.
  - **Free drop-in credit granted** — one per `promo_credits` row.
  - **Checked in** — one per non-undone `checkins` row.
- Routing is hand-rolled — a direct load or reload of `/students/:id` (including a
  live-updates-triggered reload) lands back on that student's page, not the list.
