import type { ProgramSchedule, StudentStatus } from "./api.js";

// Matches server/src/lib/date.ts's STUDIO_TIMEZONE — every date-sensitive comparison in
// this app is Pacific-zoned, including this client-side one, so backdating against a
// browser in a different timezone still resolves the same weekday the server would.
const STUDIO_TIMEZONE = "America/Los_Angeles";
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function todayInStudioTz(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIMEZONE }).format(new Date());
}

function weekdayNameFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Filters `programs` (the full Active list, fetched once on load — see App.tsx) down
// to whichever are actually scheduled for `dateStr`: active on that weekday, within
// the program's start/end date range, and not in its skip dates. Re-run against
// whichever date (live or backdated) is currently relevant, so backdating re-filters
// instantly with no extra round-trip to the server.
export function activeProgramsForDate(programs: ProgramSchedule[], dateStr: string): ProgramSchedule[] {
  const weekday = weekdayNameFor(dateStr);
  return programs.filter((p) => {
    if (!p.weekdays.includes(weekday)) return false;
    if (p.startDate && p.startDate > dateStr) return false;
    if (p.endDate && p.endDate < dateStr) return false;
    if (p.skipDates.includes(dateStr)) return false;
    return true;
  });
}

// Shared between CheckInDialog and KioskCheckInDialog.
export function isCheckedInToday(student: StudentStatus, programId: string, role: "Lead" | "Follow"): boolean {
  return student.checkinsToday.some((c) => c.programId === programId && c.role === role);
}

export function isProgramCheckedInToday(student: StudentStatus, programId: string): boolean {
  return student.checkinsToday.some((c) => c.programId === programId);
}

// Every program sharing `programId`'s start time, including itself — the set of
// {class, role} options a student can only take one of. A student can't be in two
// classes at once, and can't dance a single class as both Lead and Follow at once
// either, so the whole group (every role of every program at that time) behaves as
// one choice: see CheckInDialog.tsx/KioskCheckInDialog.tsx for how picking one
// grays the rest of the group rather than disabling it outright, unless one of them
// is already an actual check-in today, which locks the whole group.
export function timeslotGroup(programs: ProgramSchedule[], programId: string): ProgramSchedule[] {
  const current = programs.find((p) => p.id === programId);
  if (!current) return [];
  return programs.filter((p) => p.startTime === current.startTime);
}

// Studio-local time as minutes since midnight, for `at` (defaulting to the real
// current instant) — kept as a plain number instead of constructing/comparing actual
// Date instants across timezones (a sharp edge this app is otherwise careful about,
// see server/src/lib/date.ts). `at` is only ever overridden for kiosk's admin-only
// "simulate now" testing control (see KioskPage.tsx) — real usage always means now.
function studioMinutesSinceMidnight(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STUDIO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  return hour * 60 + minute;
}

// Kiosk-only: a class stops showing up once Start Time + Visible For has passed.
// Front desk never calls this — staff can still fix/add check-ins after a class's
// visible window closes (see docs/airtable-schema.md, Programs.Visible For).
export function withinVisibleWindow(program: ProgramSchedule, at?: Date): boolean {
  if (program.visibleForSeconds == null || !program.startTime) return true;
  const [hour, minute] = program.startTime.split(":").map(Number);
  const endMinutes = hour * 60 + minute + program.visibleForSeconds / 60;
  return studioMinutesSinceMidnight(at) < endMinutes;
}
