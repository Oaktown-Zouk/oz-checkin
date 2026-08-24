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
}

export interface CheckinFields {
  Member?: string[];
  "Checked In At"?: string;
  "Class Level"?: string[]; // link -> Programs
  Role?: "Lead" | "Follow";
  "Needs Review"?: boolean;
  "Review Reason"?: string;
  "Undone At"?: string;
  Credits?: string[]; // link -> Credits, set once Automation C/backdated-path consumes one
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
}

export interface CreditFields {
  Member?: string[];
  "Purchased By"?: string[];
  Reason?: "New Member" | "Drop-in Purchase" | "Comp";
  "Source Transaction"?: string[];
  "Granted At"?: string;
  "Consumed At"?: string;
  "Consumed By Check-in"?: string[];
  Available?: number;
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

export type UserRole = "Staff" | "Volunteer" | "Kiosk";

export interface UserRoleFields {
  Email?: string;
  Role?: string[]; // link -> Role Permissions (one row per role)
}

export type Permission =
  | "View Student Data"
  | "Write Student Data"
  | "Create Checkins"
  | "Undo Checkins"
  | "Write Memberships";

export interface RolePermissionFields {
  Role?: string; // the role's display name ("Staff"/"Volunteer"/"Kiosk"), not a link
  "View Student Data"?: boolean;
  "Write Student Data"?: boolean;
  "Create Checkins"?: boolean;
  "Undo Checkins"?: boolean;
  "Write Memberships"?: boolean;
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
}
