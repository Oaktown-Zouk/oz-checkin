export interface CheckInInfo {
  id: string;
  checkedInAt: string;
  programId: string | null;
  programName: string | null;
  role: "Lead" | "Follow" | null;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface CheckInSelection {
  programId: string;
  role: "Lead" | "Follow";
}

export interface StudentStatus {
  id: string;
  name: string;
  // The raw Preferred Name field, for prefilling an edit dialog — already folded
  // into `name` above by Airtable's own Full Name formula, so this is never used for
  // display on its own.
  preferredName: string | null;
  email: string;
  contactId: string | null;
  leadLevel: number | null;
  followLevel: number | null;
  accessStatus: string;
  membershipStatus: string;
  tierName: string | null;
  classesAllowed: number;
  remaining: number;
  availableCredits: number;
  checkinsToday: CheckInInfo[];
  checkedInToday: boolean;
  // Programs/roles from this student's most recent check-in occasion, computed once as
  // part of the roster fetch — see CheckInDialog for how it's used to preselect.
  lastCheckinSelections: CheckInSelection[];
}

export interface NoteDetails {
  id: string;
  summary: string;
  strengths: string;
  opportunities: string;
  issuerName: string;
  // The signed-in User Roles record id that wrote this note — compared against the
  // viewer's own session to decide whether to show an Edit button (see
  // StudentPage.tsx). Undefined for a session type that doesn't carry a userRoleId
  // (e.g. a Student session), which never matches, so the button never shows there.
  issuerRoleId: string;
}

export interface TimelineEvent {
  type: "membership_started" | "membership_status" | "payment" | "credit_granted" | "checkin" | "levelup" | "note";
  at: string;
  label: string;
  note?: NoteDetails;
}

export interface StudentTimeline {
  status: StudentStatus;
  totalCheckIns: number;
  mostRecentCheckInAt: string | null;
  events: TimelineEvent[];
}
