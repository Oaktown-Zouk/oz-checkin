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
  student, shown as small badges and editable inline, with every actual change logged
  to a `Levelups` table (who signed off on it, and when).
- **Teacher notes** — a free-form Summary/Strengths/Opportunities note a teacher can
  leave on a student, shown inline on their timeline and in full via a detail modal.
- **Membership transfers** — move a Recurring Plan (membership) to a different student
  (e.g. someone bought a membership for a friend).
- **Backdating** — view and correct check-ins for a past day via an effective
  date/time picker. Creating a *new* check-in for a past day still works, but the
  tier-allowance/credit-consumption decision is computed by the app for that path
  specifically, since Airtable's live formulas only ever mean literal "today" — see
  "Check-in semantics" below.
- **Student detail pages** with a synthesized timeline (membership events, payments,
  credits granted, check-ins, level changes, notes) and running stats.
- **Manual refresh** — no live cross-device push (Netlify Functions can't hold a
  connection open); a "Refresh" button re-fetches the roster.
- **Google OAuth or password login**, per-account roles (`Staff`/`Volunteer`/`Kiosk`/
  `Admin`) looked up in Airtable, stateless signed-cookie session.
- **Kiosk mode** (`/kiosk`) — a self-serve check-in station for a tablet: a student
  scans a QR code (their Givebutter contact id) or types their name, taps Lead/Follow,
  and walks in with no staff involvement. See "Kiosk mode" below.
- **Student self-service login** — a completely separate app (its own frontend,
  backend, and deployment) where a student can sign in with the same Google account
  their Member record uses (provided they've actually transacted or hold a recurring
  plan — contact info alone isn't enough) and see a read-only view of their own
  timeline (check-ins, level history, notes) plus their kiosk check-in QR code. See
  "Student self-service app" below.

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
table. Granting is still entirely Airtable automations; **consuming and freeing a
credit are now both application code**, not automations:

- **`Credits`** — `Member` (holder), `Purchased By` (payer, for a future transfer
  feature), `Reason` (`New Member` / `Drop-in Purchase` / `Comp`), `Source Transaction`,
  `Granted At`, `Consumed By Check-in`, `Available` (formula: true iff `Consumed By
  Check-in` is unlinked — this makes a credit self-heal if the check-in that consumed
  it is ever deleted directly in Airtable, not just undone through the app).
- **Automation A** grants a credit when a new `Members` record is created.
- **Automation B** grants a credit when a `Transactions` record qualifies as a
  drop-in purchase (succeeded, one-time, no plan).
- ~~**Automation C**~~ — retired. It used to run on every new `Check-ins` record whose
  `Checked In At` was literally today, consuming the member's oldest `Available` credit
  (or flagging `Needs Review`) whenever `Remaining Today` went negative. In practice it
  was slow and occasionally unreliable, and — since this app's own backdated-check-in
  code path already had to reimplement the identical logic (see below) and manual/QA
  testing leans on that path — the live path's reliance on the real automation wasn't
  getting regularly exercised either, letting failures go unnoticed. `createCheckIns`
  (`services/checkins.ts`) now calls that same logic itself, synchronously, for every
  check-in it creates — live or backdated — instead of leaning on Automation C for the
  live case. **Automation C must be disabled in Airtable**, or a live over-allowance
  check-in will be double-gated: the app consumes a credit, and the still-active
  automation, independently seeing a negative `Remaining Today`, consumes a second one
  for the same check-in.
- ~~**Automation D**~~ — also retired, though less urgently than C: it used to run
  whenever a `Check-ins` record's `Undone At` got set, freeing any credit that
  check-in had consumed. `undoCheckIn` (`services/checkins.ts`) now does this itself,
  immediately, reading the check-in's own `Credits` reverse link (populated by
  whichever credit consumed it) to find the credit to free — no separate table scan
  needed. Unlike Automation C, leaving Automation D active alongside this isn't a
  correctness bug (clearing an already-unlinked `Consumed By Check-in` is a no-op, not
  a double-effect), just redundant. Disable it in Airtable when convenient.

The app's own gating logic (`gateCheckIns`, `services/checkins.ts`) counts that
student's existing non-undone check-ins on the target date (live or backdated),
compares against their current `Classes Allowed`, and either does nothing, consumes
the oldest available credit, or flags the check-in for review — one implementation
for both cases now, where previously only the backdated path used it.

## Dance levels

Each student has an independent **Lead level** and **Follow level**, 1–4 or unset,
front-desk-set (`Members.Lead Level` / `Follow Level`). Displayed as small badges — a
blue square with the digit for Lead, a purple circle for Follow, gray when unset — at
the left edge of the badge row in both the check-in list and the student detail page.
Clicking either badge (or the corresponding stat box on the detail page) opens a picker
dialog. Unchanged from the previous version of this app.

**Every actual change is logged** to a `Levelups` table (`server/src/services/
studentStatus.ts`'s `updateStudentLevel`) — teacher-facing history of when a student
leveled up and who signed off on it. A row records `Member`, `Role` (Lead/Follow),
`From`/`To` (either can be blank: no `From` for a student's first-ever level in that
role, no `To` if the level was cleared back to unset), and `Issuer` — the signed-in
account's `User Roles` record, taken directly from the session (see "Auth" below,
`UserAccess.userRoleId`) rather than looked up fresh, so this costs exactly one
Airtable write, not two. Re-saving the same level (e.g. a duplicate request) is a
no-op and logs nothing. See `docs/airtable-schema.md`'s "Levelups" section for the
full field list.

## Notes

Free-form, teacher-written notes on a student — **Write Student Data**, same
permission as editing levels. "Add note" sits next to the "Timeline" heading on the
student detail page and opens a dialog with three fields: a one-line **Summary**,
and two paragraphs — "What `<Student>` is doing well:" (**Strengths**) and "What
`<Student>` should work on:" (**Opportunities**). Only Summary is required.

Saved via `POST /api/students/:id/notes` (`server/src/services/notes.ts`'s
`createNote`) to a `Notes` table — `Member`, `Issuer` (from the session's
`userRoleId`, same zero-extra-lookup pattern as `Levelups.Issuer`), `Summary`,
`Strengths`, `Opportunities`. Shows up as its own event in the student timeline (see
"Student detail page" below), inline as **Note from `<Issuer>`:** `<Summary>` — only
the "Note from X:" prefix is bold, the summary itself isn't. Clicking that row opens
a modal with the full note (Summary, Strengths under "Doing well", Opportunities
under "Should work on"). See `docs/airtable-schema.md`'s "Notes" section for the
full field list.

Only the note's own author can edit it — the detail modal shows an **Edit** button
(reusing the same add-note dialog, prefilled) only when the signed-in session's own
`userRoleId` matches that note's `Issuer`, both client-side (`StudentPage.tsx`
compares against `/api/session`'s now-exposed `userRoleId`) and server-side
(`PATCH /api/students/:id/notes/:noteId` → `updateNote`, which 403s if the caller
isn't the original issuer, regardless of what the client shows). Other staff can
still read every note on a student's timeline, same as always — just not alter
someone else's write-up.

## Check-in semantics

- **Program + Role, not a single "Check In" button.** Front desk opens the check-in
  picker, sees that day's active `Programs` (today, or the backdated date if viewing
  one), and for each program picks Lead or Follow. Selecting several picks across
  *different* timeslots and submitting creates one `Check-ins` record per selection;
  each is independently gated (checking into 2 classes when the tier only allows
  1/day correctly consumes/flags for the second one).
- **Programs are listed by start time** (`Programs.Start Time`), grouped with a
  divider between timeslots — classes sharing a slot sort alphabetically within it.
  A student can only take one {class, role} per timeslot — not two different classes
  at once, and not the same class as both Lead and Follow at once — so every
  {class, role} option within one timeslot (`web/src/programSchedule.ts`'s
  `timeslotGroup`) is really one choice, treated two different ways depending on
  whether it's already committed:
  - **Not yet submitted**: picking one option in the slot grays out the rest of that
    slot's options (including the other role of the *same* class) but leaves them
    clickable — picking a different one switches the choice to it rather than adding
    a second pick, exactly like a radio button. This is purely a local UI state, not
    yet written anywhere.
  - **Already checked in today**: shows checked off (✓), and now the *whole slot* is
    locked — every other option, including the other role of that same class, is
    disabled outright rather than grayed. That choice was already made and written;
    changing it needs Undo, not another pick here.
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

## Merging duplicate students

Whatever syncs Givebutter into `Members` doesn't match emails case-insensitively, so
the same real person can end up with two rows (e.g. `cindy@gmail.com` and
`Cindy@gmail.com`) — a recurring problem, not a one-off. **Merge duplicate…**, next to
Transfer membership in the roster row's 3-dot menu
(`server/src/services/merge.ts`'s `mergeMembers`, `POST /api/students/merge`, same
`Write Memberships` permission), fixes one pair at a time.

- **Finding the other record** (`web/src/components/MergeDialog.tsx`): a local name
  search against the roster already loaded in `App.tsx` — no extra fetch — since both
  halves of a duplicate pair are, by definition, both still showing up on the roster
  today (that's the visible symptom). The row the dialog was opened from is excluded
  from its own search results.
- **Picking the survivor**: the user always makes the final call, but the dialog
  pre-selects whichever side has an active membership (`accessStatus === "Active"`,
  Airtable's own formula — not re-derived here) once `heldMemberships` loads for both
  candidates, so the common case needs no extra click. Only overrides the default (the
  row the dialog was opened from) when exactly one side has one.
- **What moves**: every link from the loser to the survivor — `Check-ins.Member`,
  `Recurring Plans.Member` and `.Covers Member` (independently — see "Membership
  transfers" above for why they can diverge), `Transactions.Member`, `Credits.Member`
  and `.Purchased By`, `Levelups.Member`, `Notes.Member`. Most of a Member's stats
  (`Classes Allowed`, `Tier Name`, `Available Credits`, `Remaining Today`,
  `Recently Active`) are Airtable rollups/formulas over these same linked tables, so
  once the links move, those numbers recompute themselves — merging is repointing
  links, not recomputing counts by hand.
- **The one-per-student exception**: an Airtable automation grants every new `Members`
  row its own `New Member` signup credit. If both halves of a duplicate pair got one,
  reassigning both would double it up — that credit specifically is left attached to
  the loser instead (see next bullet), every other `Credits.Reason` reassigns
  normally.
- **The loser**: flagged `Duplicate = true`, not deleted — hidden from the roster
  (`NOT({Duplicate})`, same as an existing manually-flagged Givebutter merge leftover)
  but still there to audit, including whatever didn't get reassigned (the extra
  `New Member` credit above). Flagged last, only once every reassignment has actually
  landed, so a failure partway through leaves it visible and the merge safely
  retryable — Airtable has no cross-table transaction, but every reassignment is
  independently idempotent.
- **Gap-filling**: `Phone`, `Lead Level`, `Follow Level`, and `Contact ID` copy from
  the loser onto the survivor only when the survivor doesn't already have a value —
  never overwrites something the survivor already has.
- **Not automated on purpose**: if both sides have their own active Recurring Plan,
  that's the studio actually double-billing someone — merging the `Members` rows
  doesn't fix that, only canceling one subscription in Givebutter does. The dialog
  shows both plans plainly (so it's hard to miss) rather than guessing which to
  keep.

## Permissions

Access is permission-based, not role-based — a role is just Airtable's way of
grouping permissions together, and every route/UI action checks a specific
permission, never a role name directly. Two tables drive this (full detail in
`docs/airtable-schema.md`):

- **`User Roles`** — an identifier (a Google account email for OAuth rows, or a plain
  chosen identifier for a kiosk password-login row) → a linked `Role Permissions` row.
  A row optionally carries `Password Hash` too, only ever set on password-login rows
  (see "Auth" below) — never on an OAuth row, which authenticates via Google instead.
- **`Role Permissions`** — one row per role (`Staff`/`Volunteer`/`Kiosk`/`Admin`), a
  checkbox per permission: `View Student Data`, `Write Student Data`,
  `Create Checkins`, `Undo Checkins`, `Write Memberships`, `Backdate Kiosk`. `Kiosk`
  deliberately has neither `View Student Data` nor `Write Student Data` — only
  `Create Checkins`/`Undo Checkins` — so a kiosk session can never reach the roster at
  all, not even a read-only view of it (see "Kiosk mode" below). `Backdate Kiosk` is
  Admin-only and unlocks a "simulate now" date control on `/kiosk`, for testing time-
  sensitive kiosk behavior (see "Kiosk mode").

Resolved once at login and baked into the session cookie (see "Auth" below) — an
admin can tune what a role can do in Airtable without a code deploy, but a change
takes effect on that account's next login, not live. The frontend mirrors the same
permissions via a `PermissionsProvider` context (`web/src/permissions.ts`), so a role
missing a permission doesn't just get a 403 from the API — the corresponding button
never renders in the first place (e.g. no Undo link without `Undo Checkins`, no level-
edit badges without `Write Student Data`, no Transfer menu item without
`Write Memberships`). A session with no `View Student Data` can't reach the roster at
all: one with `Create Checkins` (i.e. `Kiosk`) is routed to `/kiosk` instead (see
"Kiosk mode" below); one with neither sees a "not authorized for this page" screen
naming the signed-in account.

This permission model is specific to the staff app (`web/`/`server/`). The separate
student app (see "Student self-service app" below) doesn't participate in it at all —
a student session carries `role: "Student"` and an empty `permissions: []`, and access
is identity-scoped (this one `Members` record) rather than permission-scoped. It's a
deliberately different, simpler model for a fundamentally different kind of account:
one row per role config doesn't make sense when every student needs to see exactly
one thing, their own data, and nothing else.

## Architecture

```
┌───────────────────────────────────────────────┐
│ Netlify                                        │
│                                                 │
│  Static SPA (React/Vite build) ── served by ──▶│ Netlify CDN
│                                                 │
│  Netlify Functions (one Hono app, all routes)  │
│     ├─ auth (Google OAuth, kiosk password,     │
│     │        logout, session)                  │
│     ├─ GET  students                (roster)   │
│     ├─ PATCH students/:id/lead-level           │
│     ├─ PATCH students/:id/follow-level         │
│     ├─ GET  students/:id/timeline              │
│     ├─ GET  students/:id/memberships           │
│     ├─ POST students/:id/transfer-membership   │
│     ├─ POST students/:id/notes                 │
│     ├─ GET  programs                           │
│     ├─ POST checkins                           │
│     ├─ DELETE checkins/:id                     │
│     ├─ GET  kiosk/roster                       │
│     └─ GET  kiosk/students/:id                 │
│              │                                 │
│              ▼                                 │
│    airtable/client.ts (real or mock — below)   │
└───────────────────────────────────────────────┘
```

- **Backend:** Hono, via its Netlify adapter (`hono/netlify`) — one function
  (`netlify/functions/api.mts`) handles the whole `/api/*` surface via Netlify
  Functions v2 path-based routing. Locally runs the same way under `netlify dev`, or
  standalone via `@hono/node-server` (`server/src/dev.ts`, `npm run dev`) for quicker
  iteration without the Netlify runtime.
- **Airtable client:** `server/src/airtable/client.ts` is a thin dispatcher, not the
  HTTP implementation itself — it delegates to `realClient.ts` (the actual `fetch`
  wrapper: pagination, 429 retry, no SDK dependency) or `mockClient.ts` (an in-memory
  fake, see "Testing" below) based on `MOCK_AIRTABLE`, gated identically to
  `DEV_LOGIN_ENABLED` below. Every `services/*.ts` file imports from `client.ts`, never
  `realClient.ts`/`mockClient.ts` directly, so the swap is invisible to them.
- **Frontend:** React + Vite SPA, hand-rolled routing (`window.history.pushState` + a
  `popstate` listener) — no router library, the app has three "pages": the roster, a
  student detail page, and `/kiosk`. Built to static files (`web/dist`), served by
  Netlify's CDN. Since routing is client-side, a fresh load or refresh of a deep URL
  (`/kiosk`, `/students/:id`) has no matching static file — `netlify.toml`'s catch-all
  `/* -> /index.html` redirect (status 200) sends it to the SPA anyway, which then
  routes it correctly once React mounts. Doesn't shadow `/api/*`/`/health`, which are
  matched by the function's own `path` config (`netlify/functions/api.mts`) before
  Netlify falls through to this redirect. Local `netlify dev` doesn't reproduce a
  missing-redirect bug here either way — it proxies to Vite's own dev server, which
  already does SPA-friendly fallback on its own; the failure mode only shows up
  against the real static-hosted build.
- **Navigation:** a top-left hamburger (`NavMenu.tsx`) linking "Front Desk" and
  "Kiosk," present on all three pages but only rendered for a session holding both
  `View Student Data` and `Create Checkins` — i.e. only when there's actually more
  than one destination it could send that session to. A `Kiosk`-only session (just
  `Create Checkins`) never sees it, since `/kiosk` is the only page it can reach
  anyway.
- **Auth:** Google OAuth (authorization code flow, `server/src/routes/auth.ts`) — sign-in
  redirects to Google, the callback exchanges the code server-side and reads the
  account's email from Google's userinfo endpoint, then resolves it to a role and
  permission set via Airtable (`services/userAccess.ts`; see "Permissions" below). On
  success the app mints its own stateless HMAC-signed session cookie carrying
  `{ email, role, permissions, userRoleId }` (`server/src/lib/session.ts`) —
  `userRoleId` is the `User Roles` row's own record id, resolved once here rather than
  looked up again wherever "who did this" needs recording (currently just
  `Levelups.Issuer`, see "Dance levels" above). No server-side session store (fits
  serverless) and no re-checking Airtable on every request. `mintSession`
  (`routes/auth.ts`) is the one place that cookie gets set, shared by every login path
  below.
  - **Password login** (`POST /api/auth/kiosk-login { identifier, password }`): a
    plain identifier/password form shown right on the login screen (`Login.tsx`),
    alongside the Google button, not a separate page — whichever method succeeds
    mints the same kind of session, so there's no reason to force every login through
    OAuth once passwords are stored properly. In practice this is set up for kiosk
    tablets specifically: they're unattended, shared devices, and putting a real staff
    member's Google account on one is a bad fit, so a `Kiosk`-role session
    authenticates with one shared identifier/password instead (see "Kiosk mode"). The
    password is hashed with Node's built-in `crypto.scrypt`
    (`server/src/lib/password.ts` — OWASP's #2-ranked algorithm for password storage,
    chosen over adding a `bcrypt`/`argon2` dependency) and stored in a
    `User Roles.Password Hash` field alongside the normal `Email`/`Role` columns — a
    password-login row is just a `User Roles` row with that field set, resolved via
    `getPasswordAuthForIdentifier` (`services/userAccess.ts`), and nothing about the
    lookup restricts it to the `Kiosk` role. Login failures (unknown identifier or
    wrong password) return the same generic error either way — no user enumeration.
    No app-level rate limiting: verification always requires a live Airtable lookup
    (never cached), and Airtable's own 5 req/sec-per-base cap (`airtable/realClient.ts`)
    already throttles guess throughput, as long as the password itself is a real
    passphrase rather than a short PIN. Set/rotated via
    `npx tsx src/scripts/setKioskPassword.ts <identifier> <newPassword>` — no in-app
    UI for it, matching the "rare, deliberate operation" pattern already used for
    `audit:credits`.
  - **Dev login** (`GET /api/auth/dev-login?email=`, gated behind
    `DEV_LOGIN_ENABLED=true` *and* `NODE_ENV !== "production"`, not just wired up
    conditionally so a single misconfigured var can't activate it in prod) mints a real
    session the same way, skipping Google's consent screen — useful for an agent or
    script to verify UI changes without a human present. Restricted to a fixed allowlist
    of four real `User Roles` test accounts, one per role (`claude-staff@test.com`,
    `claude-volunteer@test.com`, `claude-kiosk@test.com`, `claude-admin@test.com`) — it
    can't be used to impersonate an actual staff member even if the env gate above were
    ever misconfigured. Every attempt (allowed or rejected) is logged to the
    server/function console.
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

## Testing

Three layers, all built on one mock (`server/src/airtable/mockClient.ts`) that stands
in for Airtable behind the exact interface `services/*.ts` already calls — see
"Airtable client" above for how it gets swapped in (`MOCK_AIRTABLE=true` *and*
`NODE_ENV !== "production"`).

**What the mock actually computes**, vs. what's just fixture-static (seed data sets it
directly, exactly as if Airtable had already resolved it): `Members.Available
Credits`/`Checked In Today (Live)`/`Remaining Today` and `Credits.Available` are
computed live from the mock's own Checkins/Credits state (`mockCompute.ts`), because
the app's own logic depends on them staying consistent with its own mutations.
Automations C and D (consume/flag on a live check-in, free a credit on undo — see
"Credits system" above) are simulated as synchronous side effects of
`createRecords`/`updateRecord`, which is strictly *better* than real Airtable for
testing purposes: no automation lag to wait out or get bitten by. `Access Status`,
`Membership Status`, `Tier Name`, `Classes Allowed`, `Recently Active`,
`Recurring Plans.Is Active/Paid Access`, `Levelups`' `Event`/`Issuer Name`/
`Full Name (from Member)` lookups, and `Notes`' `Name`/`Full Name`/`Issuer Name`
lookups are deliberately **not** derived (no `Tiers` join, no cross-table lookup
resolution modeled at all) — the app only ever reads these as opaque,
already-resolved values, so replicating Airtable's own formulas/lookups for them
would be real effort for no behavior that needs it dynamic; a test that needs
`Issuer Name` sets it directly in the relevant fixture, exactly as if Airtable had
already resolved it. `filterByFormula` strings are
evaluated by `mockFormula.ts`, a small set of structural matchers for the handful of
shapes this codebase's own template strings actually produce (not a general parser) —
an unrecognized shape throws loudly rather than silently mis-filtering.

- **Unit tests** (`npm test`, `node:test`, `server/src/services/*.test.ts`) — fast,
  isolated, no network. `.env.test` sets `MOCK_AIRTABLE=true` plus dummy
  `AIRTABLE_PAT`/`AIRTABLE_BASE_ID` (never actually used). Each test calls
  `resetMockStore({...})` with exactly the fixture it needs.
- **Sandbox** (`npm run dev:sandbox`) — the real app running against the mock instead
  of real Airtable, for fast interactive verification with zero risk to real student
  data. Runs via the plain node server + Vite (`server/src/dev.ts` on `:3000` +
  Vite on `:5199`), **not** `netlify dev` — Netlify Functions' dev emulation reloads
  the function module on every invocation (correctly matching real serverless
  behavior), which wipes an in-memory store between requests. A long-running process
  doesn't have that problem.
  `POST /api/dev/reset-mock` (same `MOCK_AIRTABLE=true && !isProd` gating as
  dev-login) reseeds back to `server/src/airtable/sandboxSeed.ts`'s default fixtures
  without restarting the server.
- **E2E** (`npm run test:e2e`, Playwright, `e2e/*.spec.ts`) — a handful of specs
  driving a real browser against a sandbox Playwright boots itself (`e2e/
  playwright.config.ts`, four dedicated `webServer` entries on their own ports — two
  for the staff app, two more for the separate student app, see "Student
  self-service app" below — so a real dev session never collides with the E2E one).
  `workers: 1` — every spec shares the same mock-backed stores, so parallel workers
  would let one spec's `beforeEach` reset race another's in-flight assertions. The
  student app's own specs (`e2e/student-self-login.spec.ts`) override `baseURL` to
  point at its dedicated port and skip that `beforeEach` — its one data route is
  read-only, so there's nothing to reset between tests. Playwright is pinned to
  `1.48`: this repo has been developed on macOS 13, and current Playwright releases
  have dropped Chromium support for it — installing the browser needs
  `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npx playwright install chromium` on
  that OS specifically.

## API

This is the staff app's API (`server/src/app.ts`). The separate student app has its
own, much smaller route list — see "Student self-service app" below.

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
- `POST /api/auth/kiosk-login { identifier, password }` — resolves the identifier
  against `User Roles`, verifies the password against its `Password Hash`, and sets
  the session cookie on success. 401 with the same generic error either way if the
  identifier is unknown or the password is wrong — see "Auth" above.
- `POST /api/logout` — clears the session cookie.
- `GET /api/session` — `{ authenticated: boolean, email?, role?, permissions? }`.
- `GET /api/students?date=<YYYY-MM-DD>` — **View Student Data.** The full roster with
  computed status (`accessStatus`, `membershipStatus`, `tierName`, `classesAllowed`,
  `remaining`, `availableCredits`, `checkinsToday`, `checkedInToday`,
  `lastCheckinSelections` — see "Check-in semantics"). `date` defaults to today; 400 if
  malformed. No `q` param — the frontend fetches the unfiltered roster once and
  searches client-side, same as before.
- `GET /api/students/:id/timeline` — **View Student Data.** Synthesized event feed
  (membership started/status, payments, credits granted, check-ins, level changes,
  notes — see "Student detail page" below for the full event-type list) plus
  `totalCheckIns`/`mostRecentCheckInAt`. 404 if unknown id.
- `PATCH /api/students/:id/lead-level` `{ level }` — **Write Student Data.** `level` is
  `1`–`4` or `null`. 400 if invalid. Logs a `Levelups` row if the value actually
  changes — see "Dance levels".
- `PATCH /api/students/:id/follow-level` `{ level }` — **Write Student Data.** Same
  shape.
- `GET /api/students/:id/memberships` — **View Student Data.** Recurring Plans
  currently held by this student (for the transfer picker).
- `POST /api/students/:id/transfer-membership` `{ planId, targetEmail }` — **Write
  Memberships.** Moves that Recurring Plan's `Covers Member` to the student found by
  `targetEmail`. 400 if missing fields; 404 if the plan or target student doesn't
  exist; 409 if the plan doesn't currently belong to `:id` or already belongs to the
  target.
- `POST /api/students/:id/notes` `{ summary, strengths, opportunities }` — **Write
  Student Data.** Creates a `Notes` row attributed to the signed-in session. 400 if
  `summary` is blank; `strengths`/`opportunities` may be empty. 404 if the student
  doesn't exist.
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
- `GET /api/kiosk/roster?date=` — **Create Checkins.** `{ students: [{id, contactId,
  name, membershipStatus, availableCredits, remaining}] }` — every non-duplicate
  student (not just eligible ones), fetched once and cached client-side so both name
  search and QR-scan matching run locally with no per-keystroke/per-scan round trip
  (see "Kiosk mode" below). `date` is only honored for a session that also holds
  **Backdate Kiosk**; anyone else passing it gets a 403.
- `GET /api/kiosk/students/:id?date=` — **Create Checkins.** Full `StudentStatus` by
  record id — used once a roster-cache match (scan or search tap) picks a specific,
  currently-eligible student, and to refresh state after each kiosk check-in. 404 if
  unknown or no longer eligible (re-checked authoritatively, even though the frontend
  already filtered on its cached snapshot). Same `date` gating as `/roster`.

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
  Submitting doesn't block on the server: the dialog closes and the row updates
  immediately with the picked classes (an optimistic guess — see `shared`'s
  `applyOptimisticCheckin`), while the actual write and a follow-up roster read happen
  in the background and reconcile the row with the real numbers once they land. If the
  write fails, a dismissible banner at the top of the page shows the error and stays
  until closed — the row itself has already moved on by then, so there's nothing left
  to show it inline.
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
  `Credits`, `Check-ins`, `Levelups`, and `Notes` for that student — not a stored
  event log. Event types: `membership_started`, `membership_status` (non-active
  statuses only), `payment` (one per held Transaction, labeled as membership payment
  or one-time pass by whether it carries a plan), `credit_granted`, `checkin`,
  `levelup` (skipped for a student's first-ever level in a role — see "Dance levels"
  above — labeled "Assessed into Level X as a Lead/Follow" on an increase, "Changed
  to Level X as a Lead/Follow" on a decrease, or "Level cleared as a Lead/Follow" if
  the level was reset back to unset; each suffixed with "by `<issuer's first name>`"
  — read from `Levelups."Issuer Name"`, a lookup through `Issuer` — when known), and
  `note` (see "Notes" above — inline as "Note from `<Issuer>`: `<Summary>`", the row
  itself clickable to open the full Summary/Strengths/Opportunities in a modal).
- Routing is hand-rolled — a direct load or reload of `/students/:id` lands back on
  that student's page, not the list.

## Kiosk mode

`/kiosk` — a self-serve check-in station meant to be left running unattended on a
tablet, so a student can check themselves in with no front-desk involvement.

- **Login redirect**: a `Kiosk`-role account (only `Create Checkins`/`Undo Checkins`,
  no `View Student Data`) is confined to `/kiosk` entirely, not just defaulted there —
  navigating anywhere else in the app bounces straight back. Staff/Volunteer/Admin
  accounts can also reach `/kiosk` directly via `NavMenu` (they hold `Create Checkins`
  too); it's just not their default landing page.
- **Roster cache**: on load, the page fetches every non-duplicate student once
  (`GET /api/kiosk/roster`) into local state — id, Contact ID, full name, membership
  status, available credits, and remaining allowance. Both name search and QR-scan
  matching run against this local snapshot, not a per-keystroke/per-scan server round
  trip. Names are shown in full — no more privacy here than other studio-management
  tools already show on a shared device — but email/tier/badges/full status still
  aren't in the cache; those only appear once a specific student is resolved by id
  (`GET /api/kiosk/students/:id`), after a scan match or a search-result tap.
- **QR scanning**: the page opens the device's front (`user`-facing) camera — the
  same side as the screen, since the kiosk is a fixed tablet the student walks up to
  and holds their code up to — and continuously decodes frames with `jsqr` (a
  bundled, all-JS decoder — chosen over the Chrome-only `BarcodeDetector` API so this
  works on any tablet/browser). The QR
  payload is expected to be a student's Givebutter contact id (`Members.Contact ID`),
  printed on cards handed out to students. A decoded id is matched against the cached
  roster's `contactId` field locally, instantly, before ever hitting the network.
- **Name search**: a search bar above the camera feed, filtered client-side against
  the cached roster's `name` — matches everyone, not just eligible students (see
  below), so a decline can name the actual reason instead of a blanket "not found."
- **Loading feedback**: a scan match or a search-result tap opens a loading dialog
  instantly (`DialogState { kind: "loading" }`, `KioskPage.tsx`), before the
  `GET /api/kiosk/students/:id` round trip that resolves it completes — there's never
  a silent gap between "the student was recognized" and something appearing on
  screen.
- **Eligibility**: something left to spend today — `remaining > 0` or
  `availableCredits > 0` (`isEligible`, `KioskPage.tsx`). Deliberately not gated on an
  active membership — a drop-in/trial student who only ever bought credits can still
  self-check-in, same as at the front desk. Both a scan match and a search-result tap
  resolve the same way — always a fresh `GET /api/kiosk/students/:id` call, never a
  decision made off the cached roster snapshot — since that snapshot can go stale
  between when it was fetched and when a student is actually resolved (e.g. a credit
  bought or a membership renewed moments ago), and that endpoint isn't
  eligibility-gated (see `routes/kiosk.ts`), so it always returns the student's full,
  current status either way. An ineligible result shows a specific reason built
  client-side from that status (`ineligibleReason`) — "already checked in for X today"
  if they have a check-in today, else "no active membership/credits" vs. "used up
  today's classes and credits" — since it's the matched student's own status being
  shown to them, not another student's. A scan/search that matches *no one at all*
  shows a generic "please see the front desk" instead. Every decline auto-closes after
  5 seconds with no user action required.
- **Check-in dialog** (`KioskCheckInDialog`): large, touch-friendly buttons, one per
  {class, role} still available today — same pick-then-submit shape as the front
  desk's `CheckInDialog`, not an immediate per-tap check-in. Tapping a button only
  toggles a local selection; the header button reads "Cancel" while nothing is
  selected and "Done (N)" once at least one is. Cancel closes immediately with no
  message and no submission. Pressing Done doesn't block on the server: it shows
  "Welcome to Oaktown Zouk, have a great class!" and auto-closes after 5 seconds right
  away, while the actual write (`POST /api/checkins`, the same endpoint the front desk
  uses) and a follow-up roster refresh (so search/eligibility reflect it next time)
  happen in the background, not blocking the tablet for the next student. If the write
  fails, a dismissible banner shows the error and stays until closed; by then the
  student has likely already walked away, so the banner is there for staff to notice
  and follow up on, not the student.
- **Password login**: visiting `/kiosk` while signed out shows the same `Login.tsx`
  screen as every other unauthenticated route, Google button and identifier/password
  form both included — see "Auth" below. A successful password login redirects to
  `/`, and the session-derived routing there sends a `Kiosk`-role account straight
  back to `/kiosk`.
- **Log out**: a top-right button, always present regardless of permissions — the
  only sign-out affordance a `Kiosk`-only session has, since `NavMenu` (see
  "Architecture") requires permissions that session doesn't hold. Shares the corner
  with the admin-only backdate control below when both are present.
- **Visible window (kiosk-only)**: a class stops appearing in the kiosk's picker once
  `Programs.Start Time + Programs.Visible For` (a duration field, read over the API as
  a plain number of seconds) has passed — `withinVisibleWindow`,
  `web/src/programSchedule.ts`. This filter is deliberately kiosk-only: the front
  desk's `CheckInDialog` still shows every class regardless of time, since staff need
  to be able to fix or add check-ins after a class ends.
- Camera access and the decode loop persist for the page's whole lifetime (not
  re-requested per dialog open/close); an `enabled` flag just pauses whether decoded
  frames are acted on while a dialog or error message is on screen
  (`web/src/useQrScanner.ts`).
- **Testing: simulate now (Admin only)**. A session with **Backdate Kiosk** (only
  `Admin` has it) sees a small "simulate now" date/time control tucked in a corner of
  `/kiosk` (reusing the front desk's `EffectiveDateControl`/`BackdateDialog`). Setting
  it re-fetches the roster and student lookups with `?date=` and re-derives the
  visible-window check (`withinVisibleWindow`) and check-in timestamp
  (`POST /api/checkins`'s `effectiveAt`) against that simulated instant instead of the
  real current time — the whole page behaves as if it were that moment, so a Visible
  For window or an allowance reset can be tested without waiting for it to actually
  happen. Both endpoints reject a `date` param from any session lacking
  `Backdate Kiosk` (403) — a real production kiosk tablet has no way to misrepresent
  the current time even via a crafted request.

## Student self-service app

A student can sign in with the same Google account their `Members.Email` uses and see
a read-only view of their own timeline — check-ins, level history, notes. Deliberately
built as a **fully separate app** (own frontend, own backend, own deployment), not a
new page or permission on the staff app, because self-service login meaningfully
widens *who* can obtain a valid session (any Gmail account matching a studio member,
vs. the staff app's small hand-provisioned `User Roles` list) — a different threat
model that calls for a structural backstop, not just another permission check
alongside `transferMembership`/`createNote`/`updateStudentLevel` in the same process.

**The isolation is real, not just conventional.** `server/src/studentApp.ts` — a
second, minimal Hono app, deployed as its own Netlify Function
(`netlify/functions-student/student-api.mts`) at its own origin — never imports
`services/notes.ts`, `services/transfers.ts`, `services/levelups.ts`,
`routes/checkins.ts`, `routes/students.ts` (the staff one), or `routes/kiosk.ts`.
Verified by tracing its actual import graph: zero references to `createRecords` or
`updateRecord` anywhere reachable from `studentApp.ts`, not just "the route code
happens not to call them." (`services/studentStatus.ts`, which this app does import
via `studentTimeline.ts` for read-only student data, is entirely read-only itself —
`updateStudentLevel` lives in `services/levelups.ts` specifically so that importing
student status/timeline data never pulls a write-capable export along for the ride in
the same module.) A bug in this app's own code structurally cannot reach write-capable
logic, because that logic isn't part of this deployment's bundle at all.

**Auth is Members-only, not a fallback from the staff app.** The two apps' identity
resolution stays decoupled by table, not just by deployment:
`services/userAccess.ts`'s `getStudentAccessForEmail(email)` looks up `Members` by
`Email` (case-insensitive, excluding `Duplicate`-flagged rows — same filter
`listStudentStatuses` already uses) and returns just `{ studentId }`, no
role/permission resolution at all. The staff app's OAuth callback
(`server/src/routes/auth.ts`) never calls it, and this app's own OAuth callback never
calls `getAccessForEmail`. A student who lands on the staff app's Google button gets
the same `not_authorized` as always; a staff member whose email happens to also match
a Member sees their own student view here, same as anyone else — no special-casing
either direction.

**Also requires a `Transactions` or `Recurring Plans` link** — a deliberate narrowing
of who counts as a "student" for login purposes. A `Members` row can exist purely from
Givebutter capturing contact info (an abandoned checkout, a newsletter signup) with no
actual payment ever made; those rows shouldn't get a portal account just because an
email address exists. The filter is `OR(NOT({Transactions} = BLANK()), NOT({Recurring
Plans} = BLANK()))` — either link field having at least one entry is enough, checked
purely for non-emptiness (the app never reads which transactions/plans, just whether
any exist). `mockFormula.ts` gained `OR(...)` support for this (only `AND`/`NOT` were
needed before).

**Session shape**: `role: "Student"`, `permissions: []`, and a `studentId` (not
`userRoleId` — see `lib/session.ts`'s `SessionPayload`, whose validation now branches
on `role` for which id field a cookie must carry). The one data route,
`GET /api/me/timeline`, takes **no `:id` param at all** — it reads `studentId`
straight off the session (`lib/studentAuth.ts`'s `requireStudent` middleware). This is
structurally simpler than a permission check on a parameterized route: there's no id
comparison anywhere in this app for a bug to get wrong.

**Routes** (all under `server/src/studentApp.ts`):
- `GET /health`
- `GET /api/auth/google/start` / `GET /api/auth/google/callback` — same OAuth code
  flow as the staff app (state-cookie CSRF check, `verified_email` requirement).
- `GET /api/auth/dev-login?email=` — dev-only (same gating as the staff app's),
  restricted to a small fixed allowlist rather than any real member's email, same
  "can't impersonate a real person" reasoning as the staff app's own dev-login
  allowlist: `claude-student@test.com` (the sandbox's fixture student, mock-only) and
  `ben@oaktownzouk.com` (a real Member with a real Transaction, explicitly authorized
  by its owner as a real-base test identity — not an exception to the
  can't-impersonate rule, since the account owner is the one granting it).
- `POST /api/logout`
- `GET /api/session` — `{ authenticated, email?, studentId? }`.
- `GET /api/me/timeline` — the only data route, `requireStudent`-gated.

**Frontend** (`web-student/`): much smaller than the staff app — no client-side
routing, no permissions to branch on (a signed-in session here is always exactly a
Student session). Google-only login screen (no password option — students never
touch kiosk auth); once signed in, a small always-visible nav menu
(`components/NavMenu.tsx`, styled after the staff app's own hamburger nav) toggles
between two local views, plain `useState`, nothing worth deep-linking to:
- **My Progress** (`StudentSelfPage.tsx`) — the self-view page, no edit affordances
  anywhere, and critically *never imports* the components that would have any
  (`LevelEditDialog`, `TransferDialog`, `AddNoteDialog`) — there's nothing on this
  page that could be wired up to a write action even by mistake, on top of the
  backend having nowhere to send one anyway.
- **QR Code** (`StudentQrPage.tsx`) — renders the student's kiosk check-in QR code
  client-side (the `qrcode` package, browser build), encoding the bare Givebutter
  Contact ID — the exact same payload `web/src/useQrScanner.ts` decodes at the kiosk
  and `server/src/scripts/generateQrCode.ts` prints. No backend change was needed:
  `GET /api/me/timeline` already returned `status.contactId`. A member with no
  Contact ID yet (Givebutter sync gap) sees a plain "ask the front desk" message
  instead of a broken image.

Log out lives inside the nav menu now too, rather than its own standalone button —
one control at the top of the page instead of two.

**Shared code** (`shared/` workspace, consumed as TS source directly by both Vite
apps, no build step of its own): `types.ts` (`StudentStatus`, `TimelineEvent`,
`NoteDetails`, etc. — re-exported from `web/src/api.ts` so nothing in the staff app
had to change its own imports) and a handful of read-only presentational components
(`Portal`, `GoogleLogo`, `LevelBadge`, `MembershipBadge`, `Timeline`,
`NoteDetailModal`) relocated from `web/src/components/` to their single canonical
source, so the two apps' timeline rendering can't silently drift apart. Write-capable
components (the three named above) and each app's own CSS stay local, not shared.

**A separate, read-only Airtable PAT** is a real additional layer worth setting up:
the student Netlify site's own `AIRTABLE_PAT` (independent of the staff site's, same
base) should be scoped to `data.records:read` only, no write, no schema — created in
Airtable's UI. Even a hypothetical bug that got this app calling a write operation
would still be rejected by Airtable itself (403). Not yet done as of this writing —
both apps' local dev currently point at the same read/write PAT; this is called out
explicitly in `server/.env.student.example` as a recommended (not required) upgrade.

**Local dev**: `server/.env.student` (gitignored, template in
`server/.env.student.example`) — a separate env file specifically so the two apps' dev
servers can run side by side with different ports/origins, and so this app's
`AIRTABLE_PAT` can genuinely differ from the staff app's even locally.
`server/src/devStudent.ts` loads it explicitly before anything imports `config.js`
(whose own `dotenv/config` only loads the default `.env`, and dotenv never overrides
an already-set var). `npm run dev:student-server` / `dev:student-web` (mirroring
`dev:server`/`dev:web`) or the combined `dev:student-sandbox` (mirroring
`dev:sandbox` — `MOCK_AIRTABLE=true`, no risk to real data).

**Deploy**: a second Netlify site pointed at this same repo, with `web-student/` as
its publish target — config lives at `web-student/netlify.toml`, not a repo-root
`netlify-student.toml` as originally planned. Netlify only ever discovers a file
literally named `netlify.toml` (confirmed via Netlify's own docs and support forum —
no custom filename is recognized, regardless of any "Configuration file path"
setting), so the site's "Package directory" should be set to `web-student` instead,
leaving "Base directory" at its default (repo root). Paths inside that config
(`publish`, `functions.directory`) still resolve against the base directory
regardless of package directory, per Netlify's docs, which is why they stay
root-relative (`web-student/dist`, `netlify/functions-student`) — confirmed working
locally too, since `dev:netlify-student` discovers and resolves this exact file the
same way. Needs its own custom domain/subdomain and its own Google OAuth "Authorized
redirect URI" entry (same OAuth client as the staff app works fine — reused for the
extra redirect URI registered) — both are account-level setup steps, not something
this repo's code can do on its own.
