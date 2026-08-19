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

// Mirrors server/src/services/programs.ts's old per-request filtering exactly, run here
// against a Programs list fetched once on load (see App.tsx) instead of re-fetched
// every time the check-in picker opens — and re-evaluated against whichever date
// (live or backdated) is currently relevant, not just "today".
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
