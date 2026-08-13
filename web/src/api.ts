export interface CreditInfo {
  id: number;
  paidAt: string;
  amountCents: number;
  redeemed: boolean;
}

export interface PromoCreditInfo {
  id: number;
  reason: string;
  grantedAt: string;
  redeemed: boolean;
}

export interface CheckInInfo {
  id: number;
  checkedInAt: string;
  checkedInBy: string | null;
  paymentId: number | null;
  promoCreditId: number | null;
}

export interface StudentStatus {
  id: number;
  name: string;
  email: string;
  alternateEmails: string[];
  waiver: { signed: boolean; signedAt: string | null };
  membership: {
    active: boolean;
    status: string;
    frequency: string | null;
    currentPeriodEnd: string | null;
    lastPaymentAt: string | null;
    coversCheckIn: boolean;
  } | null;
  credits: {
    available: number;
    total: number;
    payments: CreditInfo[];
    promo: PromoCreditInfo[];
  } | null;
  checkinsToday: CheckInInfo[];
  checkedInToday: boolean;
  canCheckIn: boolean;
  requiresCreditToCheckIn: boolean;
  everCheckedIn: boolean;
}

export interface SyncStatus {
  google_forms: string | null;
  givebutter: string | null;
}

export interface TimelineEvent {
  type:
    | "membership_started"
    | "membership_status"
    | "membership_payment"
    | "payment"
    | "promo_credit"
    | "checkin";
  at: string;
  label: string;
}

export interface StudentTimeline {
  status: StudentStatus;
  firstRegisteredAt: string | null;
  mostRecentCheckInAt: string | null;
  totalCheckIns: number;
  events: TimelineEvent[];
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
  checkIn: (studentId: number, paymentId?: number, effectiveAt?: string) =>
    request<StudentStatus>("/api/checkins", {
      method: "POST",
      body: JSON.stringify({ studentId, paymentId, effectiveAt }),
    }),
  undoCheckIn: (checkinId: number) =>
    request<StudentStatus>(`/api/checkins/${checkinId}`, { method: "DELETE" }),
  syncStatus: () => request<SyncStatus>("/api/sync/status"),
  triggerSync: () => request<unknown>("/api/sync", { method: "POST" }),
  mergeStudent: (studentId: number, otherEmail: string) =>
    request<StudentStatus>(`/api/students/${studentId}/merge`, {
      method: "POST",
      body: JSON.stringify({ otherEmail }),
    }),
  studentTimeline: (studentId: number) =>
    request<StudentTimeline>(`/api/students/${studentId}/timeline`),
};
