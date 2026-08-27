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
  summary: string;
  strengths: string;
  opportunities: string;
  issuerName: string;
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
