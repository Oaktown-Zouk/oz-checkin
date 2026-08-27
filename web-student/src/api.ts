import type { StudentTimeline } from "shared";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
  }
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);

  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) throw new ForbiddenError();

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  session: () => request<{ authenticated: boolean; email?: string; studentId?: string }>("/api/session"),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  // No :id param anywhere — this always resolves to the signed-in session's own
  // studentId server-side (see server/src/studentApp.ts).
  timeline: () => request<StudentTimeline>("/api/me/timeline"),
};
