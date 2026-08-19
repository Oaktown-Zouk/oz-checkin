export interface CheckInInfo {
  id: string;
  checkedInAt: string;
  programName: string | null;
  role: "Lead" | "Follow" | null;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface StudentStatus {
  id: string;
  name: string;
  email: string;
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
}

export interface ProgramSchedule {
  id: string;
  name: string;
  weekdays: string[];
  startDate: string | null;
  endDate: string | null;
  skipDates: string[];
}

export interface HeldMembership {
  id: string;
  status: string;
  frequency: string | null;
  amount: number | null;
}

export interface TimelineEvent {
  type: "membership_started" | "membership_status" | "payment" | "credit_granted" | "checkin";
  at: string;
  label: string;
}

export interface StudentTimeline {
  status: StudentStatus;
  totalCheckIns: number;
  mostRecentCheckInAt: string | null;
  events: TimelineEvent[];
}

export interface CheckInSelection {
  programId: string;
  role: "Lead" | "Follow";
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only claim a JSON body when there actually is one — some JSON parsers reject an
  // empty body sent with Content-Type: application/json, so setting this
  // unconditionally would break every no-body call (e.g. undoCheckIn).
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) throw new UnauthorizedError();

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  session: () => request<{ authenticated: boolean }>("/api/session"),
  login: (password: string) =>
    request<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  // No `q` — the frontend fetches the full roster and filters locally (see App.tsx) so
  // typing in the search box doesn't round-trip to the server on every keystroke.
  students: (date?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    return request<StudentStatus[]>(`/api/students?${params.toString()}`);
  },
  // Fetched once on load (see App.tsx), not per check-in dialog open — filtered by
  // date client-side, see programSchedule.ts.
  programs: () => request<ProgramSchedule[]>("/api/programs"),
  checkIn: (studentId: string, selections: CheckInSelection[], effectiveAt?: string) =>
    request<StudentStatus>("/api/checkins", {
      method: "POST",
      body: JSON.stringify({ studentId, selections, effectiveAt }),
    }),
  undoCheckIn: (checkinId: string) =>
    request<StudentStatus>(`/api/checkins/${checkinId}`, { method: "DELETE" }),
  studentTimeline: (studentId: string) =>
    request<StudentTimeline>(`/api/students/${studentId}/timeline`),
  updateLeadLevel: (studentId: string, level: number | null) =>
    request<StudentStatus>(`/api/students/${studentId}/lead-level`, {
      method: "PATCH",
      body: JSON.stringify({ level }),
    }),
  updateFollowLevel: (studentId: string, level: number | null) =>
    request<StudentStatus>(`/api/students/${studentId}/follow-level`, {
      method: "PATCH",
      body: JSON.stringify({ level }),
    }),
  heldMemberships: (studentId: string) =>
    request<HeldMembership[]>(`/api/students/${studentId}/memberships`),
  transferMembership: (studentId: string, planId: string, targetEmail: string) =>
    request<StudentStatus>(`/api/students/${studentId}/transfer-membership`, {
      method: "POST",
      body: JSON.stringify({ planId, targetEmail }),
    }),
};
