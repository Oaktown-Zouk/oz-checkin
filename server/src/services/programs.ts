import { listRecords, TABLES } from "../airtable/client.js";
import type { ProgramFields } from "../airtable/fields.js";
import { today } from "../lib/date.js";

export interface ProgramSummary {
  id: string;
  name: string;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayNameFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function parseSkipDates(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// Defaults to today, but accepts an explicit date so the check-in picker shows the
// right classes when backdating (e.g. adding a forgotten check-in for a past Thursday).
export async function activePrograms(dateStr: string = today()): Promise<ProgramSummary[]> {
  const weekday = weekdayNameFor(dateStr);

  const programs = await listRecords<ProgramFields>(TABLES.programs, {
    filterByFormula: "{Status} = 'Active'",
    fields: ["Program Name", "Weekdays", "Start Date", "End Date", "Skip Dates"],
  });

  return programs
    .filter((p) => {
      const f = p.fields;
      if (!(f.Weekdays ?? []).includes(weekday)) return false;
      if (f["Start Date"] && f["Start Date"] > dateStr) return false;
      if (f["End Date"] && f["End Date"] < dateStr) return false;
      if (parseSkipDates(f["Skip Dates"]).has(dateStr)) return false;
      return true;
    })
    .map((p) => ({ id: p.id, name: p.fields["Program Name"] ?? "Unnamed program" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
