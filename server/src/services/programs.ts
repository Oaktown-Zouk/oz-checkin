import { listRecords, TABLES } from "../airtable/client.js";
import type { ProgramFields } from "../airtable/fields.js";

export interface ProgramSchedule {
  id: string;
  name: string;
  weekdays: string[];
  startDate: string | null;
  endDate: string | null;
  skipDates: string[];
  startTime: string | null;
  // Seconds. Kiosk-only visibility window (Start Time + this) — front desk ignores
  // it entirely, see web/src/programSchedule.ts's withinVisibleWindow.
  visibleForSeconds: number | null;
}

function parseSkipDates(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Fetched once by the client on load rather than re-fetched every time the check-in
// picker opens — the weekday/date-range/skip-dates filtering (see
// web/src/programSchedule.ts) happens client-side against whichever date (live or
// backdated) is currently relevant, so one fetch covers the whole session.
export async function listActivePrograms(): Promise<ProgramSchedule[]> {
  const programs = await listRecords<ProgramFields>(TABLES.programs, {
    filterByFormula: "{Status} = 'Active'",
    fields: ["Program Name", "Weekdays", "Start Date", "End Date", "Skip Dates", "Start Time", "Visible For"],
  });

  return programs
    .map((p) => ({
      id: p.id,
      name: p.fields["Program Name"] ?? "Unnamed program",
      weekdays: p.fields.Weekdays ?? [],
      startDate: p.fields["Start Date"] ?? null,
      endDate: p.fields["End Date"] ?? null,
      skipDates: parseSkipDates(p.fields["Skip Dates"]),
      startTime: p.fields["Start Time"] ?? null,
      visibleForSeconds: p.fields["Visible For"] ?? null,
    }))
    // Chronological (classes at the same time grouped together — see CheckInDialog's
    // divider), then by name within a time slot.
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.name.localeCompare(b.name));
}
