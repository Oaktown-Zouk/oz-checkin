import type { ProgramSchedule } from "./api.js";

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
