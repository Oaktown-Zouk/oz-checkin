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
