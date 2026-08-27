// Types shared with web-student/ (the read-only student self-service app) — see
// shared/src/types.ts. Re-exported from here so every existing `../api.js` importer
// in this app keeps working unchanged.
import type { CheckInInfo, CheckInSelection, StudentStatus, NoteDetails, TimelineEvent, StudentTimeline } from "shared";
export type { CheckInInfo, CheckInSelection, StudentStatus, NoteDetails, TimelineEvent, StudentTimeline };

export interface ProgramSchedule {
  id: string;
  name: string;
  weekdays: string[];
  startDate: string | null;
  endDate: string | null;
  skipDates: string[];
  startTime: string | null;
  visibleForSeconds: number | null;
}

export interface HeldMembership {
  id: string;
  status: string;
  frequency: string | null;
  amount: number | null;
}

export type Permission =
  | "View Student Data"
  | "Write Student Data"
  | "Create Checkins"
  | "Undo Checkins"
  | "Write Memberships"
  | "Backdate Kiosk";

export interface KioskRosterEntry {
  id: string;
  contactId: string | null;
  name: string;
  membershipStatus: string;
  availableCredits: number;
  remaining: number;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

// Valid session, but the account's role isn't allowed on this route (e.g. a
// Volunteer/Kiosk account hitting the staff-only API surface).
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
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
  if (res.status === 403) throw new ForbiddenError();

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  session: () =>
    request<{
      authenticated: boolean;
      email?: string;
      role?: "Staff" | "Volunteer" | "Kiosk" | "Admin";
      permissions?: Permission[];
    }>("/api/session"),
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
  addNote: (studentId: string, summary: string, strengths: string, opportunities: string) =>
    request<{ ok: true }>(`/api/students/${studentId}/notes`, {
      method: "POST",
      body: JSON.stringify({ summary, strengths, opportunities }),
    }),
  // Kiosk mode — fetched once and cached client-side (see KioskPage.tsx) so search
  // and QR-scan matching both run locally with no per-keystroke/per-scan round trip.
  // Deliberately a lightweight shape (never the full StudentStatus) — see
  // services/kiosk.ts's listKioskRoster for why. `date` is only honored server-side
  // for a session holding Backdate Kiosk (Admin only); anyone else passing it gets a
  // 403 (caught as ForbiddenError), see routes/kiosk.ts.
  kioskRoster: (date?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    return request<{ students: KioskRosterEntry[] }>(`/api/kiosk/roster?${params.toString()}`);
  },
  kioskStudent: (studentId: string, date?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    return request<StudentStatus>(`/api/kiosk/students/${studentId}?${params.toString()}`);
  },
  kioskLogin: (identifier: string, password: string) =>
    request<{ ok: true }>("/api/auth/kiosk-login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),
};
