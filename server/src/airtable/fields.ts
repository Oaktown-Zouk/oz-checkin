// Field shapes for the Airtable tables this app reads/writes. Only fields the app
// actually touches — see docs/airtable-schema.md for the full base schema.

export interface MemberFields {
  "Full Name"?: string;
  Email?: string;
  Phone?: string;
  "Lead Level"?: number;
  "Follow Level"?: number;
  "Access Status"?: string;
  "Membership Status"?: string;
  "Tier Name"?: string;
  "Classes Allowed"?: number;
  "Remaining Today"?: number;
  "Available Credits"?: number;
  // Flat signup bonus, defaulting to 1 in Airtable's own field config so every new
  // Member row gets one with zero automation logic needed. Only ever read/written by
  // services/merge.ts's fillMemberGaps (copy-if-missing, same as Phone/Lead Level) —
  // everywhere else just reads the combined "Available Credits" formula, which folds
  // this in along with Credits Purchased and Comp Credits.
  "New Member Credit"?: number;
  // Set manually when Givebutter's own contact-merge tool doesn't actually remove the
  // merged-away contact — it keeps re-syncing as a separate record otherwise. Excluded
  // from the roster (see studentStatus.ts); not a schema-level dedupe, just a hide flag.
  Duplicate?: boolean;
  // 1 iff Last Activity (max of last check-in / last transaction, both computed in
  // Airtable) is within the last 30 days — that threshold lives in the Airtable
  // formula, not here, so it's tunable without a code deploy. Drives roster sort order
  // (see listStudentStatuses), not currently displayed.
  "Recently Active"?: number;
  // Link to the matching Tiers row, maintained by an Airtable automation (not part of
  // this app) that runs when Membership Amount is updated — see
  // docs/airtable-schema.md, "Tier Rule gaps" (under Members). Empty when that
  // automation hasn't (or can't) match this member to a Tier; drives the "treat as a
  // non-member" badge fallback (see MembershipBadge.tsx) and the credit-consumption
  // audit script (scripts/auditCreditConsumption.ts).
  "Tier Rule"?: string[];
  // Givebutter's contact id — printed on a student's kiosk QR code, so kiosk mode can
  // resolve a scan straight to a Member (see services/kiosk.ts).
  "Contact ID"?: string;
  // Link fields, only ever checked for non-emptiness (never read individually) — gate
  // student self-service login to members who've actually transacted, not just left
  // contact info with no payment. See getStudentAccessForEmail.
  Transactions?: string[];
  "Recurring Plans"?: string[];
  // Lookup fields through the Levelups link, one array per Levelups column, added so
  // studentTimeline.ts can build this member's levelup events straight off their own
  // Member record instead of scanning the whole Levelups table. Airtable Lookups
  // silently *drop* an entry when the source field is blank on that linked record
  // (confirmed empirically, not documented) rather than leaving a placeholder — since
  // From/To are blank on a real, common subset of Levelups rows (first-ever level /
  // cleared level), reading them directly would desync this array's length from
  // Role/Issuer Name/Created's, corrupting the by-index zip below. "From (safe, from
  // Levelups)"/"To (safe, from Levelups)" pull through Levelups formula fields that
  // coalesce blank to -1 instead, so all five arrays are guaranteed the same length —
  // -1 is translated back to "blank" in studentTimeline.ts.
  "Role (from Levelups)"?: ("Lead" | "Follow")[];
  "From (safe, from Levelups)"?: number[];
  "To (safe, from Levelups)"?: number[];
  "Issuer Name (from Levelups)"?: string[];
  "Created (from Levelups)"?: string[];
}

export interface CheckinFields {
  Member?: string[];
  "Checked In At"?: string;
  "Class Level"?: string[]; // link -> Programs
  Role?: "Lead" | "Follow";
  "Needs Review"?: boolean;
  "Review Reason"?: string;
  "Undone At"?: string;
  // 1 iff this check-in consumed a credit (set by services/checkins.ts's gateCheckIns,
  // cleared by undoCheckIn), 0/blank otherwise. Members."Credits Consumed" rolls this
  // up per member -- deleting a check-in directly in Airtable (not undoing it through
  // the app) still self-heals that rollup, same self-healing property the old
  // Credits-table design had.
  "Credits Consumed"?: number;
  Method?: "Form" | "Staff" | "Kiosk";
}

export interface ProgramFields {
  "Program Name"?: string;
  Status?: "Planned" | "Active" | "Completed" | "Canceled";
  Weekdays?: string[];
  "Start Date"?: string;
  "End Date"?: string;
  "Skip Dates"?: string;
  "Start Time"?: string; // "HH:mm", 24-hour zero-padded — sorts correctly as plain text
  // Duration field, read as a plain number of seconds (e.g. 2700 = 45 min). Kiosk-only
  // visibility window: a class stops showing up in the kiosk picker once
  // Start Time + Visible For has passed — front desk deliberately ignores this, see
  // web/src/programSchedule.ts's withinVisibleWindow.
  "Visible For"?: number;
}

// A manually (or future-automation) granted comp credit -- kept as its own table
// rather than a plain number specifically so comp grants stay individually
// auditable, the same reasoning that originally made the old Credits table a table.
// Members."Credits Comped" rolls up the sum of Amount per member (not
// Members."Comp Credits" -- that name belongs to the plain reverse-link field
// Airtable auto-created for the Member link below; the rollup is a separate field).
// "Granted" is Airtable's own Created time field type -- auto-set on row creation,
// never written by the app, so there's no separate "when was this granted" entry to
// maintain.
export interface CompCreditFields {
  Member?: string[];
  Amount?: number;
  Reason?: string;
  Granted?: string;
}

export interface RecurringPlanFields {
  "Plan ID"?: string;
  Status?: string;
  Amount?: number;
  Frequency?: string;
  "Start Date"?: string;
  "Next Bill Date"?: string;
  "Canceled At"?: string;
  Member?: string[];
  "Covers Member"?: string[];
  "Is Active Membership"?: number;
  "Is Paid Access"?: number;
}

// "Student" is synthetic — never a real Role Permissions row, and never resolved via
// User Roles at all. It's minted only by the separate student app (server/src/
// studentApp.ts) for an OAuth login matching a Members.Email, not a staff account —
// see SessionPayload's studentId for how that session is identified instead of by
// userRoleId.
export type UserRole = "Staff" | "Volunteer" | "Kiosk" | "Admin" | "Student";

export interface UserRoleFields {
  Email?: string;
  Role?: string[]; // link -> Role Permissions (one row per role)
  "Password Hash"?: string; // set only on password-login (kiosk) rows, never OAuth ones
}

// A record of a student's Lead/Follow level being set, written once per level
// change that actually changes the value — see services/studentStatus.ts's
// updateStudentLevel. `Event`, `Full Name (from Member)`, `Issuer Name`, and
// `Created` are Airtable-computed/auto-set fields on this table — never written by
// the app.
export interface LevelupFields {
  Member?: string[]; // link -> Members (exactly one)
  Issuer?: string[]; // link -> User Roles (exactly one) — who made the change
  // Lookup (through Issuer) of that User Roles row's "First Name" — read-only, used
  // to attribute a level change in the student timeline without a second lookup.
  "Issuer Name"?: string[];
  Role?: "Lead" | "Follow";
  From?: number; // omitted (blank) for a student's first-ever level in this role
  To?: number; // omitted (blank) if the level was cleared back to unset
}

// A free-form note a teacher leaves on a student — see services/notes.ts's
// createNote. `Name`, `Full Name`, `Issuer Name`, and `Created` are
// Airtable-computed/auto-set fields on this table — never written by the app.
export interface NoteFields {
  Member?: string[]; // link -> Members (exactly one)
  Issuer?: string[]; // link -> User Roles (exactly one) — who wrote the note
  Summary?: string; // shown inline on the student timeline
  Strengths?: string; // "What {Student} is doing well"
  Opportunities?: string; // "What {Student} should work on"
  // Lookup (through Issuer) of that User Roles row's "First Name" — read-only, used
  // to attribute the note in the student timeline without a second lookup.
  "Issuer Name"?: string[];
}

export type Permission =
  | "View Student Data"
  | "Write Student Data"
  | "Create Checkins"
  | "Undo Checkins"
  | "Write Memberships"
  // Lets a session pass ?date= to the kiosk-only read endpoints (roster, student
  // lookup) to simulate "now" for testing — e.g. checking a Visible For window
  // without waiting for a real class time. Granted to Admin only; a real Kiosk-role
  // session must never see or use this. See SPEC.md's "Kiosk mode".
  | "Backdate Kiosk";

export interface RolePermissionFields {
  Role?: string; // the role's display name ("Staff"/"Volunteer"/"Kiosk"/"Admin"), not a link
  "View Student Data"?: boolean;
  "Write Student Data"?: boolean;
  "Create Checkins"?: boolean;
  "Undo Checkins"?: boolean;
  "Write Memberships"?: boolean;
  "Backdate Kiosk"?: boolean;
}

export interface TransactionFields {
  "Transaction ID"?: string;
  Amount?: number;
  Status?: string;
  "Transacted At"?: string;
  Member?: string[];
  "Plan ID"?: string;
  "Is Recurring"?: boolean;
  Refunded?: boolean;
  // How many drop-in credits this transaction bought (set by the
  // grant-dropin-credits.js automation). Rolls up into Members."Credits Purchased";
  // also shown directly on this transaction's own studentTimeline.ts "payment" entry.
  "Credits Purchased"?: number;
}
