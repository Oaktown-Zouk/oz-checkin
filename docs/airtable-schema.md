# Airtable schema mapping (Phase 0 output)

Reference for Phase 2 (the Netlify Functions rewrite). Base ID `appn5AoJ7935NUCc5`.
Covers the tables this app actually reads/writes; `Programs`, `Benefits`, `Perk
Redemptions`, `Monthly Summary`, and `Sync Log` exist in the base but aren't touched by
this app directly (Programs is only relevant transitively, via `Sessions`).

**Guiding principle** (per product decision): read Airtable's *computed* fields
(formula/rollup) directly rather than reimplementing their logic in the server. If a
formula changes in Airtable (e.g. drop-in expiry window), the app should pick that up
automatically on the next read, not require a redeploy.

## Old SQLite concept → Airtable

| Old (`server/src/db/schema.ts`) | Airtable | Notes |
|---|---|---|
| `students` | `Members` (`tbl90E8ZFxXlZrVkn`) | Email/name/phone already there. `lead_level`/`follow_level` → `Lead Level`/`Follow Level` (plain numbers, already exist). |
| `student_emails` (merge) | — | Feature dropped. |
| `waivers` | — | Feature dropped. |
| `givebutter_contacts` | `Members.Contact ID` | Just a field now, not a separate table. |
| `memberships` | `Recurring Plans` (`tblRJAL7UjNf9N0WB`) | `holder_student_id` split already exists as `Member` (payer) vs. `Covers Member` (holder). |
| `membership_charges` | `Transactions` where `Is Recurring` is checked | No separate table — charges and one-time payments share `Transactions`, disambiguated by `Is Recurring` + `Plan ID` presence. |
| `payments` (one-time credits) | `Transactions` (raw) + `Credits` (redeemable) | See "Credits system" below — `Credits` is the new source of truth for "is this spendable," not a formula on `Transactions`. |
| `promo_credits` | `Credits` where `Reason = "New Member"` | Same table as purchased credits now — see below. |
| `checkins` | `Check-ins` (`tblUN06HQtcMIucxK`) | Richer: links to `Session`/`Event`, not just a bare date. Undo sets `Undone At` (added this session) rather than deleting the row — see "Credits system" below. |
| `sync_state` | — | N/A; Airtable's own sync (Sync Log table) is independent of this app. |

## Credits system (built this session, see plan file for design rationale)

`Credits` (`tblCFmQJntHiuMZNN`): `Member` (holder), `Purchased By` (payer, defaults
same as Member — mirrors the `Recurring Plans` holder split so a future "transfer a
credit" action has somewhere to write), `Reason` (`New Member` / `Drop-in Purchase` /
`Comp`), `Source Transaction` (link → Transactions, set only for `Drop-in Purchase`),
`Granted At`, `Consumed At` (blank = available), `Consumed By Check-in`, `Available`
(formula: `IF({Consumed At}, 0, 1)`), `Credit`/`Credit ID` (display formulas).

Three Airtable automations maintain it (built + verified working):
- **A** — new `Members` record → creates a `Credits` row (`Reason = New Member`).
- **B** — `Transactions` record entering the "qualifying drop-in" view (`succeeded`,
  not recurring, no `Plan ID`) → creates a `Credits` row (`Reason = Drop-in Purchase`).
- **C** — new `Check-ins` record → script bumps `Members.Checked In Today`/`Last
  Check-in Date`, stamps `Check-ins.Nth Today`, and if the check-in exceeds
  `Members.Classes Allowed`, consumes the member's oldest `Available` credit (or sets
  `Needs Review`/`Review Reason` if none exists).

**The app should not reimplement "is this credit valid" or "how many credits does this
member have"** — filter `Credits` by `Member` + `Available = 1`, that's it.

### Undo (finalized, resolves the earlier open question)

`Check-ins.Undone At` (dateTime) — the app sets this on undo rather than deleting the
row, preserving history like the old app did. Everything downstream is now
self-maintaining, verified end-to-end against live throwaway test data:

- `Check-ins.Is Counted` (formula) — 1 if `Checked In At` is today (studio timezone)
  and `Undone At` is blank, else 0.
- `Members.Checked In Today (Live)` (rollup: SUM of `Is Counted`) replaces the old
  plain `Checked In Today`/`Last Check-in Date` fields, which are now dead (no
  automation writes them anymore) — safe to delete.
- `Members.Remaining Today` = `{Classes Allowed} - {Checked In Today (Live)}`.
- `Credits.Available` keys off whether `Consumed By Check-in` is still linked, **not**
  `Consumed At` — so even a check-in deleted directly in Airtable (bypassing the app's
  undo flow entirely) self-heals the credit via Airtable's own link-integrity, with no
  automation involved. Verified directly: delete a Check-in that had consumed a credit
  → `Available` flips back to `1` instantly.
- Automation C (consume): reads `Member.Remaining Today` post-check-in-creation: if
  negative, consumes the oldest `Available` credit or sets `Needs Review`. No longer
  touches `Members` at all.
- Automation D (free on undo): triggers when `Undone At` becomes non-blank; finds the
  `Credits` record whose `Consumed By Check-in` points at this check-in and clears
  `Consumed At`/`Consumed By Check-in`.

**Implementation note for Phase 2:** `Check-ins.Checked In At` must be set explicitly
on every create call — nothing defaults it, and `Check-in ID`/`Is Counted` both error
(`#ERROR!`) if it's blank. The check-in endpoint must always stamp it.

## Field reference — computed fields to read directly (don't recompute)

**`Members`:**
- `Access Status` (formula) — `"Active"` (has an active Recurring Plan) / `"Paid"` (has
  a recent drop-in or recent check-in) / `"Inactive"`.
- `Remaining Today` (formula) — `Classes Allowed - Checked In Today (Live)`, fully live
  (see "Undo" above) — safe to read at any time, self-corrects on undo or deletion.
- `Checked In Today (Live)` (rollup) — sum of today's non-undone check-ins. Purely
  derived; nothing writes to it directly.
- `Unused Drop-ins` (formula) — legacy, superseded by counting `Credits` where
  `Available = 1`; likely fine to leave as-is or eventually deprecate, not load-bearing
  for the new app.
- `Tier Name` / `Classes Allowed` (rollups via `Tier Rule` → `Tiers`).
- `Membership Status` (formula) — `"Active"` / `"Lapsed / Donor"` / `"Prospect"` — a
  donor-status label, distinct from `Access Status`.
- `Subscription Status` (formula) — human-readable recurring-plan status string.
- `Checked In Today` / `Last Check-in Date` — **legacy, dead.** Nothing writes to these
  anymore (Automation C no longer touches them); safe to delete once confirmed nothing
  else in the base references them.

**`Recurring Plans`:** `Is Active Membership`, `Is Paid Access` (formulas) — read these
instead of reimplementing the old `isMembershipActive`/`membershipCoversCheckIn` logic
from `studentStatus.ts`.

**`Transactions`:** `Drop-in Valid` (formula, 14-day expiry) — superseded by `Credits`
for actual redemption; may still be useful for reporting, not for check-in logic.

**`Sessions`/`Events`:** `Attendance Count` (count of linked `Check-ins`) — read
directly rather than counting check-ins ourselves.

## Check-in flow (resolved)

`Check-ins` fields relevant to the flow (old `Level`/`Second Class Level` deleted by
the user, `Class Level` repurposed):
- `Class Level` (link → `Programs`, despite the name) — which class this check-in is
  for. **Direct link to `Programs`, not `Sessions`** — the app does not resolve a
  specific dated `Session` instance; `Sessions`/`Session` stay unused by this app
  (Events keeps its own separate flow, untouched here).
- `Role` (single select: `Lead` / `Follow`, added this session) — which role the
  member is checking in as for that class. One per check-in row; a member checking
  into a program as both Lead and Follow would need two check-in rows (matches the UX
  below — one row per Program, one role choice per row).

**UX:** front desk picks a student, then sees today's active `Programs` as a list, each
row with a Lead/Follow choice (single-select per row, like a radio pair — not a
freestanding checkbox pair). Multiple programs can be selected at once; submitting
creates one `Check-ins` record per selected `{Program, Role}` pair. Each created
Check-in independently runs through Automation C (gating/credit-consumption is
per-check-in, so checking into 2 programs when the tier only allows 1/day correctly
consumes/flags for the second one, same as two check-ins on separate visits would).

**Still to design in Phase 2:** the "today's active Programs" filter — `Status =
Active`, today's weekday in `Weekdays`, within `Start Date`/`End Date`, and not in
`Skip Dates` (free text — needs a defined date format to parse reliably; check with the
user what format `Skip Dates` actually uses before writing this filter).

## Transfers (resolved)

Confirmed in scope, membership only for now (per user: "I think we just need the api
to update Covers Member in Recurring Plans"). `Recurring Plans` already has the
`Member`/`Covers Member` holder split — the transfer endpoint is a straightforward
Airtable record update (`Covers Member` → new holder), no schema changes needed.
Credit transfers (`Credits.Purchased By`) exist in the schema for the same purpose but
weren't asked for yet — don't build that endpoint unless/until requested.

## Duplicate members (resolved)

Givebutter's own contact-merge tool doesn't actually remove the merged-away contact —
it keeps existing there and the sync (which just upserts by Contact ID, with no concept
of "these are the same person") re-creates an Airtable Member for it on a later run,
even after the stray record is manually deleted (confirmed: happened twice in the same
session for one contact). Manual deletion doesn't stick; a persistent flag does.

`Members.Duplicate` (checkbox, added this session) — set manually once a duplicate is
spotted. `services/studentStatus.ts`'s roster query excludes it server-side
(`filterByFormula: "NOT({Duplicate})"`), so it never even gets fetched, not just hidden
client-side. Direct-by-id lookups (timeline, level updates) are **not** filtered —
only the roster list, since that's where the front-desk-facing duplication actually
showed up; an admin can still open a flagged record's detail page directly if needed
(e.g. to verify before Givebutter is fixed for real, or to reconcile its stray credit —
Automation A grants a "New Member" credit on creation, so a re-synced duplicate can
pick one up too).

## User Roles (auth, added this session)

`User Roles` (`tblBeLbVbHNZIPIvz`) — maps a Google account email to an app role.
Fields: `Email` (plain text, primary), `Role` (single select: `Staff` / `Volunteer` /
`Kiosk`). Not synced from Givebutter; managed by hand — add a row before a new person
tries to sign in, there's no self-service signup.

Login is Google OAuth (see `SPEC.md`'s "Auth" section): after verifying the account
with Google, the server looks up its email here (case-insensitive) to decide the
role for the session cookie. No matching row = no access at all, not just "no role" —
the callback route redirects to `/?authError=not_authorized` without setting a
session. All current UX requires `Staff`; `Volunteer`/`Kiosk` exist as roles a session
can hold (so they don't need to re-auth once pages exist for them) but every route
built so far 403s them.

## Check-in dialog preselection (resolved)

The check-in dialog preselects whatever programs/roles a student picked on their most
recent visit (not backdating-aware — always the true most recent visit, regardless of
which date is being viewed/backdated). Computed server-side, once per roster fetch
(`services/studentStatus.ts`'s `fetchMostRecentCheckinsByMember`), not per dialog-open —
an earlier per-student endpoint was replaced with this after it proved slow at the
front desk (`StudentStatus.lastCheckinSelections`).

**Tried and abandoned: doing this via an Airtable rollup/formula instead of app code.**
The plan was a `Check-ins."Is Most Recent Check-in"` formula comparing `{Checked In
At}` against a lookup of the member's `Last Check-in At` rollup, so the app could just
filter on one boolean field instead of scanning the whole table. Hit a real platform
limit: **Airtable rollups aggregating dateTime values via `MAX()` always collapse to
date-only precision** — confirmed with two separate field-creation attempts, including
one with an explicit `"formula": "MAX(values)"` payload. Working around that by
grouping on date-only instead of exact timestamp would have needed the *day* extracted
from the rolled-up value to agree with the day extracted from `{Checked In At}` — but
the rollup's date-only rendering turned out to be in **UTC**, not the studio's Pacific
time this app is otherwise careful about (see `lib/date.ts`/`STUDIO_TIMEZONE`), risking
a real off-by-one-day bug for evening check-ins. Reverted to computing this in the app,
where the timezone handling is already correct and tested. (The two now-orphaned
fields from this attempt were deleted by hand in the Airtable UI — the REST API has no
field-deletion endpoint.)

## Last Activity / Recently Active (resolved)

Roster sort order needed a way to sink students who've gone quiet below active ones,
without hardcoding a "30 days" threshold in the app. Built the same way as the rest of
the base — real Airtable fields the app just reads, so the threshold is tunable in
Airtable without a code deploy:

- `Check-ins."Checked In At (Valid)"` (formula) — `IF({Undone At}, BLANK(), {Checked
  In At})`. Excludes undone check-ins from counting as activity.
- `Members."Last Check-in At"` (rollup) — MAX of `Checked In At (Valid)` across linked
  Check-ins.
- `Members."Last Transaction At"` (rollup) — MAX of `Transactions.Transacted At`.
- `Members."Last Activity"` (formula) — the more recent of the two above:
  `IF({Last Check-in At} > {Last Transaction At}, {Last Check-in At}, {Last Transaction
  At})`. **Not** `MAX()` — Airtable's `MAX()` on two date fields coerces the result to
  a plain number instead of preserving the date type; the `IF`-based comparison avoids
  that.
- `Members."Recently Active"` (formula) — `1`/`0`, whether `Last Activity` is within
  the last 30 days: `IF(AND({Last Activity}, IS_AFTER({Last Activity}, DATEADD(TODAY(),
  -30, "days"))), 1, 0)`. This is the field the app actually reads
  (`fields.ts`/`studentStatus.ts`) — the 30-day window lives entirely in this formula.

`services/studentStatus.ts` sorts the roster into three tiers: recently-active-and-not-
checked-in-today, then stale-and-not-checked-in-today, then checked-in-today (which
still sinks to the bottom as before). Not currently surfaced in the UI as a badge —
purely a sort signal for now.
