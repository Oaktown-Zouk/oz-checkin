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
`Follow Level` (the last two are app-writable, via the level-edit dialogs),
`Contact ID` (Givebutter's contact id, read-only here — shown on the student
self-service app's own QR code page, though `/kiosk` no longer reads it back: it
used to resolve a camera scan straight to a Member, but that scanner was removed in
favor of just typing a name, see SPEC.md's "Kiosk mode"). `Email` also drives the
separate student
self-service app's login (`services/userAccess.ts`'s `getStudentAccessForEmail`,
case-insensitive, excluding `Duplicate`-flagged rows, and requiring at least one
`Transactions` or `Recurring Plans` link — both `multipleRecordLinks` to their
respective tables, checked only for non-emptiness, never read individually) — see
`SPEC.md`'s "Student self-service app" section.

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
  keeps recreating it as a separate Member), or automatically by `services/merge.ts`'s
  `mergeMembers` on whichever side of a merge didn't survive (case-variant email
  duplicates — see `SPEC.md`'s "Merging duplicate students"). The roster query
  excludes it server-side (`NOT({Duplicate})`), so it's never fetched at all;
  direct-by-id lookups (timeline, level edits) are not filtered.
- `Tier Rule` (link → `Tiers`) — maintained by an Airtable automation that runs when
  `Membership Amount` is updated, not this app; see "Tier Rule gaps" below for when
  it's empty.

Legacy/dead, safe to ignore or delete: `Unused Drop-ins` (superseded by counting
available `Credits`), `Checked In Today` / `Last Check-in Date` (nothing writes to
these anymore).

### Tier Rule gaps

A member can show `Access Status = Active` with no resolved `Tier Name`/
`Classes Allowed` — the automation that maintains `Tier Rule` triggers off
`Membership Amount` being updated, so it can miss a member (e.g. if the amount was
only ever set, never changed after), or no `Tiers` row may match the member's actual
plan amount at all. Two things handle this:

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
  one row per Program, one role choice per row). The app's own check-in dialogs won't
  create a second row for the same Program on the same day, though — see SPEC.md's
  "Check-in semantics" — so two rows for the same program/day only happen via
  `Backfill` or a direct Airtable edit.
- `Method` (single select: `Form` / `Staff` / `Kiosk` / `Backfill`) — which UI created
  the row. The app sets `Staff`/`Kiosk` on every check-in it creates
  (`POST /api/checkins`'s `method` field, sent by each frontend — see
  `services/checkins.ts`'s `createCheckIns`); `Form` and `Backfill` are never written
  by this app (a Givebutter form submission and a manual historical import,
  respectively).
- `Undone At` (dateTime) — set by the app on undo instead of deleting the row,
  preserving history.
- `Is Counted` (formula) — `1` if `Checked In At` is today (studio timezone) and
  `Undone At` is blank, else `0`.
- `Checked In At (Valid)` (formula) — `Checked In At` unless undone, else blank; feeds
  `Members.Last Check-in At`.
- `Needs Review` / `Review Reason` — set by the app (`services/checkins.ts`'s
  `gateCheckIns`) when a check-in exceeds the member's tier allowance and no credit is
  available to cover it.
- `Credits` — reverse link, populated once a `Credits` record consumes this check-in.
  `services/checkins.ts`'s `undoCheckIn` reads this directly to find which credit to
  free on undo, rather than scanning the whole `Credits` table.

The check-in dialog preselects a student's most recent visit's programs/roles by
scanning non-undone Check-ins app-side (`StudentStatus.lastCheckinSelections`, see
`services/studentStatus.ts`) — not stored as an Airtable field, and deliberately not
backdating-aware: always the true most recent visit, regardless of which date is being
viewed.

## Credits (`tblCFmQJntHiuMZNN`)

`Member` (holder), `Purchased By` (payer — defaults same as Member, kept distinct so a
future credit-transfer feature has somewhere to write), `Reason` (`New Member` /
`Drop-in Purchase` / `Comp`), `Source Transaction` (link → Transactions, set only for
`Drop-in Purchase`), `Granted At`, `Consumed By Check-in`, `Available` (formula — true
iff `Consumed By Check-in` is unlinked, so a credit self-heals if the check-in that
consumed it is ever deleted directly in Airtable rather than undone through the app).

The app never reimplements "is this credit valid" — it filters `Credits` by `Member` +
`Available = 1`.

`services/merge.ts`'s `mergeMembers` reassigns `Member` and `Purchased By`
independently when combining two duplicate `Members` rows, except: `Reason = New
Member` credits collapse to exactly one on the survivor (preferring an
already-consumed one), with every other one **deleted** — the only place this app
deletes an Airtable record — unless two or more are already consumed, in which case
none are touched and their check-ins get flagged for review instead. See `SPEC.md`'s
"Merging duplicate students".

Granting is still Airtable automations; consuming and freeing a credit are both
application code (see SPEC.md's "Credits system" for why):
- **A** — new `Members` record → creates a `Credits` row (`Reason = New Member`).
- **B** — a `Transactions` record entering the "qualifying drop-in" view (`succeeded`,
  not recurring, no `Plan ID`) → creates a `Credits` row (`Reason = Drop-in Purchase`).

Consuming (`services/checkins.ts`'s `gateCheckIns`, run for every check-in it
creates, live or backdated) and freeing (`undoCheckIn`, via the check-in's own
`Credits` reverse link) are both handled the same way regardless of path.

## Programs (`tblB90zwd3OjKxxDs`)

`Program Name`, `Status` (`Planned`/`Active`/`Completed`/`Canceled`), `Weekdays`,
`Start Date`, `End Date`, `Skip Dates` (comma-separated `YYYY-MM-DD`), `Start Time`
(`"HH:mm"`, 24-hour zero-padded — sorts correctly as plain text), `Visible For`
(`duration` field, read over the API as a plain number of **seconds**, e.g. `2700` =
45 min — kiosk-only: `/kiosk` stops showing a class once `Start Time + Visible For`
has passed, so a class remains available to front desk indefinitely for after-the-fact
fixes but disappears from the self-serve kiosk once it's clearly over).

The app fetches all `Status = Active` programs once per session (`GET /api/programs`)
and filters/sorts them client-side against whichever date is currently relevant (live
or backdated) — see `SPEC.md`'s "Check-in semantics" for the exact filter and the
same-timeslot conflict UI this schedule data drives, and "Kiosk mode" for the
additional `Visible For` filter that only applies there.

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
signup, so add a row before a new person tries to sign in or gets a new role. These
tables are specific to the staff app — the separate student self-service app doesn't
use them at all (see `SPEC.md`'s "Student self-service app" section); a student
session's synthetic `"Student"` role never appears here as an actual `Role
Permissions` row.

- **`User Roles`** — maps an identifier to a role. Fields: `Email` (plain text,
  primary — a Google account email for an OAuth row, or a plain chosen identifier for
  a kiosk password-login row), `Role` (**link** → `Role Permissions`, not a select —
  one row per role, so an admin tunes what a role can do in one place), `Password
  Hash` (plain text, optional — set only on password-login rows via
  `npx tsx src/scripts/setKioskPassword.ts`, never by hand, and never set on an OAuth
  row; see `SPEC.md`'s "Auth" section). Includes four
  `claude-{staff,volunteer,kiosk,admin}@test.com` rows, one per role — not real people,
  the fixed allowlist `GET /api/auth/dev-login` accepts (see `SPEC.md`'s "Auth"
  section).
- **`Role Permissions`** — one row per role (`Staff` / `Volunteer` / `Kiosk` / `Admin`,
  `Role` plain text primary), with a checkbox per permission: `View Student Data`,
  `Write Student Data`, `Create Checkins`, `Undo Checkins`, `Write Memberships`,
  `Backdate Kiosk`. Every route in the app requires exactly one of these — see
  `SPEC.md`'s "Permissions" section for the full route → permission map. Check the
  table directly for the live grants. `Kiosk` is deliberately `Create Checkins` +
  `Undo Checkins` only — no `View Student Data` — so a kiosk session is routed straight
  to `/kiosk` and can never reach the roster (see `SPEC.md`'s "Kiosk mode"). `Admin` is
  the only role with `Backdate Kiosk` — it lets `/kiosk` show a "simulate now" date
  control for testing, without giving a real production kiosk tablet any way to
  misrepresent the current time.

Login is Google OAuth for Staff/Volunteer/Admin, or a shared password for Kiosk
tablets: after verifying the account with Google (or the password against the row's
`Password Hash`, for a kiosk login), the server looks up the identifier in
`User Roles` (case-insensitive), follows the `Role` link to `Role Permissions`, and
bakes the role name, the resolved permission list, and the `User Roles` row's own
record id into the signed session cookie (`services/userAccess.ts`'s
`getAccessForEmail`/`getPasswordAuthForIdentifier`) — permission changes take effect
on that account's next login, not live. No matching `User Roles` row at all means no
access — the callback route redirects to `/?authError=not_authorized` without setting
a session. A row with a role but none of the permissions a given page needs still gets
a session (so it doesn't need to re-auth once a page exists for it), but the relevant
routes 403 it, and the frontend shows a "not authorized for this page" screen instead
of the roster. The record id (`userRoleId` in the session, `UserAccess.userRoleId` in
`userAccess.ts`) exists so a write that needs to record "who did this" — currently
just `Levelups.Issuer`, below — never needs a second Airtable lookup at write time.

## Levelups (`tblSFmkH7KlWVRmfM`)

One row per Lead/Follow level *change* — written by `services/studentStatus.ts`'s
`updateStudentLevel` whenever a `PATCH /students/:id/lead-level` or `.../follow-level`
call actually changes the value (re-saving the same level is a no-op, not logged).
Lets the studio answer "when did this student level up, and who signed off on it."

- `Member` (link → `Members`, exactly one) — the student.
- `Issuer` (link → `User Roles`, exactly one) — whoever made the change, from the
  signed-in session's `userRoleId` (see "User Roles & Role Permissions" above) — never
  a fresh lookup, so this write costs exactly one Airtable call.
- `Role` (single select: `Lead` / `Follow`) — which level this row is about.
- `From` (number) — the level before the change. **Blank** for a student's first-ever
  level in that role (there's nothing to record it changed *from*).
- `To` (number) — the level after the change. **Blank** if the level was cleared back
  to unset.
- `Event` (formula, read-only) — a human-readable summary built from the above, e.g.
  "Lead from 2 to 3" or "Lead initially 2". Never written by the app.
- `Issuer Name` (lookup through `Issuer`, read-only) — the issuer's `User Roles.First
  Name`. Read by `services/studentTimeline.ts` to attribute a level change in the
  student timeline (e.g. "... by Jane") without a second lookup.
- `Full Name (from Member)` (lookup, read-only) and `Created` (Airtable's own
  auto-set creation timestamp) — also never written by the app.
- `From (safe)` / `To (safe)` (formula, read-only) — `IF({From} = BLANK(), -1, {From})`
  and the `To` equivalent. Exist purely so the Members-side Lookups below have
  something non-blank to pull through; nothing on this table itself reads them.

**Members' Lookup fields through this table** (`Role (from Levelups)`,
`From (safe, from Levelups)`, `To (safe, from Levelups)`, `Issuer Name (from
Levelups)`, `Created (from Levelups)`) let `services/studentTimeline.ts` build a
student's levelup events straight off their own `Members` record, with no separate
read of this table at all. **Why `(safe)` and not plain `From`/`To`**: confirmed by
testing directly against real data — Airtable's Lookup fields silently *drop* an
entry when the source field is blank on that linked record, rather than keeping a
placeholder. Since `From`/`To` are legitimately blank on a real, common subset of
rows (first-ever level, cleared level), looking them up directly desyncs that array's
length from `Role`/`Issuer Name`/`Created`'s — the app zips these five arrays
together by index to reconstruct each levelup record, and a length mismatch corrupts
that silently. Routing through `From (safe)`/`To (safe)` (which are never blank)
keeps all five arrays the same length; the app translates `-1` back to "blank" on the
way in. There are also `From (from Levelups)`/`To (from Levelups)` Lookups still
sitting on `Members` from before this was diagnosed — broken in the way just
described, unused, and harmless to leave (Airtable's API doesn't support deleting
fields, so they're stuck until removed by hand in the UI).

Same-shaped Lookups exist on `Members` for `Notes` too (`Teacher Notes` — the
auto-generated reverse link, renamed from its default `Notes 2` since `Notes` itself
was already a plain text field), but the app doesn't use them yet: `Strengths`/
`Opportunities` have the identical blank-value risk described above and don't have
`(safe)` equivalents, and `Notes` is empty in the real base as of this writing anyway
— not worth the same fix until it's an actual bottleneck.

## Notes (`tblXfNHoBzKa3mqpB`)

One row per teacher-written note on a student — written by `services/notes.ts`'s
`createNote` via `POST /students/:id/notes`. See `SPEC.md`'s "Notes" section for the
UI (the "Add note" dialog and the timeline's inline summary/detail-modal split).

- `Member` (link → `Members`, exactly one) — the student the note is about.
- `Issuer` (link → `User Roles`, exactly one) — whoever wrote it, from the signed-in
  session's `userRoleId` (see "User Roles & Role Permissions" above) — same
  zero-extra-lookup pattern as `Levelups.Issuer`. Also the edit gate: `updateNote`
  (`PATCH /students/:id/notes/:noteId`) 403s unless the caller's own `userRoleId`
  matches this field — see `SPEC.md`'s "Notes" section.
- `Summary` (single line text) — the only required field; shown inline on the
  student timeline.
- `Strengths` (long text) — "What `<Student>` is doing well," optional.
- `Opportunities` (long text) — "What `<Student>` should work on," optional.
- `Name` (formula, read-only), `Full Name` (lookup through `Member`, read-only),
  `Issuer Name` (lookup through `Issuer`, read-only — the issuer's `User Roles.First
  Name`, read by `services/studentTimeline.ts` to attribute the note in the student
  timeline without a second lookup), and `Created` (Airtable's own auto-set creation
  timestamp) — none of these are ever written by the app.

## Sessions / Events

Not used by this app's check-in flow — `Check-ins.Class Level` links directly to
`Programs`. `Attendance Count` (count of linked `Check-ins`) exists on these tables if
ever needed for reporting; read it directly rather than counting check-ins.
