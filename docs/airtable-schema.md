# Airtable Schema Reference

Base ID `appn5AoJ7935NUCc5`. Documents the tables and fields this app reads or writes,
and the business logic that lives in Airtable formulas/automations rather than in this
app's code.

**Guiding principle:** read Airtable's *computed* fields (formula/rollup) directly
rather than reimplementing their logic in the server — a formula change in Airtable
takes effect on the next read, no code deploy needed.

Tables not covered here (`Sessions`, `Events`, `Benefits`, `Perk Redemptions`,
`Monthly Summary`, `Sync Log`) exist in the base but aren't read or written by this
app, except `Sessions`/`Events`' `Attendance Count` rollup — see the bottom of this
doc. `Check-ins.Class Level` links directly to `Programs`, not a specific dated
`Session`, so this app never resolves a `Session` instance.

## Members (`tbl90E8ZFxXlZrVkn`)

Plain fields the app reads or writes: `Full Name`, `Email`, `Lead Level`,
`Follow Level` (the last two are app-writable, via the level-edit dialogs).

Computed fields to read directly, never recompute:
- `Access Status` (formula) — `"Active"` (has an active Recurring Plan) / `"Paid"`
  (recent drop-in or check-in) / `"Inactive"` / `"Trial"` (new sign-ups). The app only
  ever branches on literally `"Active"` vs. everything else — `Trial` behaves like
  `Inactive`: no access-status badge, credits shown instead.
- `Membership Status` (formula) — `"Active"` / `"Lapsed / Donor"` / `"Prospect"`, a
  donor-status label distinct from `Access Status`.
- `Tier Name` / `Classes Allowed` (rollups via `Tier Rule` → `Tiers`) — can be blank
  even for an `Active` member; see "Tier Rule gaps" below.
- `Remaining Today` (formula) — `Classes Allowed - Checked In Today (Live)`. Fully
  live: self-corrects on undo or on a check-in being deleted directly in Airtable.
- `Checked In Today (Live)` (rollup) — sum of today's non-undone check-ins.
- `Available Credits` (rollup) — count of this member's `Credits` where
  `Available = 1`.
- `Recently Active` (formula) — `1`/`0` depending on whether `Last Activity` (below)
  is within the last 30 days. Drives roster sort order (recently-active members sort
  above stale ones); the 30-day threshold lives entirely in this formula, tunable
  without a code deploy.
- `Last Activity` (formula) — the more recent of `Last Check-in At` and
  `Last Transaction At` (both rollups), via an `IF` comparison rather than `MAX()` —
  Airtable's `MAX()` on two date fields coerces the result to a plain number, losing
  the date type.
- `Duplicate` (checkbox) — set by hand when Givebutter's contact-merge tool leaves a
  stray record behind (it doesn't actually delete the merged-away contact, so the sync
  keeps recreating it as a separate Member). The roster query excludes it server-side
  (`NOT({Duplicate})`), so it's never fetched at all; direct-by-id lookups (timeline,
  level edits) are not filtered.
- `Tier Rule` (link → `Tiers`) — maintained by an external nightly plans sync, not
  this app; see "Tier Rule gaps" below for when it's empty.

Legacy/dead, safe to ignore or delete: `Unused Drop-ins` (superseded by counting
available `Credits`), `Checked In Today` / `Last Check-in Date` (nothing writes to
these anymore).

### Tier Rule gaps

A member can show `Access Status = Active` with no resolved `Tier Name`/
`Classes Allowed` — the external sync that maintains `Tier Rule` can lag behind a
membership change, or no `Tiers` row may match the member's actual plan amount at all.
Two things handle this:

- **UX fallback** (`web/src/components/MembershipBadge.tsx`) — a member only gets the
  "N Class Membership" badge when `Access Status = Active` **and** `Tier Name` is
  resolved. Otherwise they're treated as a non-member for display purposes: no badge,
  credits shown instead.
- **`npm run audit:credits`** (`server/src/scripts/auditCreditConsumption.ts`) — since
  a tier-less member's `Classes Allowed` rolls up to `0`, every one of their check-ins
  should have consumed a credit or been flagged `Needs Review`. This script finds any
  that did neither and links the member's oldest unclaimed `Available` credit. It
  never fabricates a new credit — a genuine price/tier mismatch needs a human decision
  about what actually happened, not an automatic guess.

## Check-ins (`tblUN06HQtcMIucxK`)

- `Member` (link → Members).
- `Checked In At` (dateTime) — must be set explicitly on every create call; nothing
  defaults it, and dependent formulas (`Check-in ID`, `Is Counted`) error out if blank.
- `Class Level` (link → `Programs`, despite the name) — which class this check-in is
  for.
- `Role` (single select: `Lead` / `Follow`) — one per row; a member checking into a
  program as both Lead and Follow needs two check-in rows (matches the check-in UX:
  one row per Program, one role choice per row).
- `Undone At` (dateTime) — set by the app on undo instead of deleting the row,
  preserving history.
- `Is Counted` (formula) — `1` if `Checked In At` is today (studio timezone) and
  `Undone At` is blank, else `0`.
- `Checked In At (Valid)` (formula) — `Checked In At` unless undone, else blank; feeds
  `Members.Last Check-in At`.
- `Needs Review` / `Review Reason` — set by Automation C when a check-in exceeds the
  member's tier allowance and no credit is available to cover it.
- `Credits` — reverse link, populated once a `Credits` record consumes this check-in.

The check-in dialog preselects a student's most recent visit's programs/roles by
scanning non-undone Check-ins app-side (`StudentStatus.lastCheckinSelections`, see
`services/studentStatus.ts`) — not stored as an Airtable field, and deliberately not
backdating-aware: always the true most recent visit, regardless of which date is being
viewed.

## Credits (`tblCFmQJntHiuMZNN`)

`Member` (holder), `Purchased By` (payer — defaults same as Member, kept distinct so a
future credit-transfer feature has somewhere to write), `Reason` (`New Member` /
`Drop-in Purchase` / `Comp`), `Source Transaction` (link → Transactions, set only for
`Drop-in Purchase`), `Granted At`, `Consumed At`, `Consumed By Check-in`, `Available`
(formula — true iff `Consumed By Check-in` is unlinked, **not** based on
`Consumed At`, so a credit self-heals if the check-in that consumed it is ever deleted
directly in Airtable rather than undone through the app).

The app never reimplements "is this credit valid" — it filters `Credits` by `Member` +
`Available = 1`.

Four Airtable automations maintain this table:
- **A** — new `Members` record → creates a `Credits` row (`Reason = New Member`).
- **B** — a `Transactions` record entering the "qualifying drop-in" view (`succeeded`,
  not recurring, no `Plan ID`) → creates a `Credits` row (`Reason = Drop-in Purchase`).
- **C** — a new `Check-ins` record → reads `Member.Remaining Today` post-creation; if
  negative, consumes the member's oldest `Available` credit, or sets `Needs Review`/
  `Review Reason` if none exists. Doesn't write to `Members` at all.
- **D** — `Check-ins.Undone At` becomes non-blank → finds the `Credits` record
  consumed by that check-in and clears `Consumed At`/`Consumed By Check-in`.

Automation C only fires for same-day check-ins (Airtable's live fields are hardcoded
to literal "today"), so **backdated check-in creation is the one place this app
computes gating itself** — mirroring Automation C's logic, parameterized by the target
date. Undo needs no such split; Automation D works for any date.

## Programs (`tblB90zwd3OjKxxDs`)

`Program Name`, `Status` (`Planned`/`Active`/`Completed`/`Canceled`), `Weekdays`,
`Start Date`, `End Date`, `Skip Dates` (comma-separated `YYYY-MM-DD`), `Start Time`
(`"HH:mm"`, 24-hour zero-padded — sorts correctly as plain text).

The app fetches all `Status = Active` programs once per session (`GET /api/programs`)
and filters/sorts them client-side against whichever date is currently relevant (live
or backdated) — see `SPEC.md`'s "Check-in semantics" for the exact filter and the
same-timeslot conflict UI this schedule data drives.

## Recurring Plans (`tblRJAL7UjNf9N0WB`)

`Member` (payer, refreshed by the Givebutter sync), `Covers Member` (holder, for
access/display — this split is what makes membership transfers a plain field update),
`Status`, `Amount`, `Frequency`, `Start Date`, `Next Bill Date`, `Canceled At`,
`Is Active Membership` / `Is Paid Access` (formulas — read these directly rather than
reimplementing membership-active logic in the app).

Synced from Givebutter on a schedule (`Last Synced`) — editing `Status`/
`Next Bill Date` directly in Airtable without also fixing the real Givebutter
subscription risks the next sync reverting the change.

## Transactions (`tbl97hoFODKY50QcH`)

Raw Givebutter charges — one-time and recurring share this table, disambiguated by
`Is Recurring` + `Plan ID` presence. `Drop-in Valid` (formula, 14-day expiry) is
superseded by `Credits` for actual redemption; may still be useful for reporting, not
for check-in logic.

## Tiers (`tblf5kiolgFrtQaIG`)

`Tier` (name), `Min Monthly Price`, `Classes Per Day`, `Classes Per Week`, `Members`
(reverse link from `Members.Tier Rule`).

## User Roles (`tblBeLbVbHNZIPIvz`) & Role Permissions (`tblYo1awEOvqBGVpR`)

Both managed by hand — neither is synced from Givebutter, and there's no self-service
signup, so add a row before a new person tries to sign in or gets a new role.

- **`User Roles`** — maps a Google account email to a role. Fields: `Email` (plain
  text, primary), `Role` (**link** → `Role Permissions`, not a select — one row per
  role, so an admin tunes what a role can do in one place). Includes three
  `claude-{staff,volunteer,kiosk}@test.com` rows, one per role — not real people, the
  fixed allowlist `GET /api/auth/dev-login` accepts (see `SPEC.md`'s "Auth" section).
- **`Role Permissions`** — one row per role (`Staff` / `Volunteer` / `Kiosk`, `Role`
  plain text primary), with a checkbox per permission: `View Student Data`,
  `Write Student Data`, `Create Checkins`, `Undo Checkins`, `Write Memberships`. Every
  route in the app requires exactly one of these — see `SPEC.md`'s "Permissions"
  section for the full route → permission map. Check the table directly for the
  live grants.

Login is Google OAuth: after verifying the account with Google, the server looks up
its email in `User Roles` (case-insensitive), follows the `Role` link to
`Role Permissions`, and bakes both the role name and the resolved permission list into
the signed session cookie (`services/userAccess.ts`'s `getAccessForEmail`) —
permission changes take effect on that account's next login, not live. No matching
`User Roles` row at all means no access — the callback route redirects to
`/?authError=not_authorized` without setting a session. A row with a role but none of
the permissions a given page needs still gets a session (so it doesn't need to
re-auth once a page exists for it), but the relevant routes 403 it, and the frontend
shows a "not authorized for this page" screen instead of the roster.

## Sessions / Events

Not used by this app's check-in flow — `Check-ins.Class Level` links directly to
`Programs`. `Attendance Count` (count of linked `Check-ins`) exists on these tables if
ever needed for reporting; read it directly rather than counting check-ins.
