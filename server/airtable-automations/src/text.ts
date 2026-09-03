// Value coercion helpers shared by every Airtable Givebutter-sync automation.
// Pure, dependency-free -- see server/airtable-automations/README.md for why
// these live here instead of directly in the pasted-into-Airtable scripts.

export function toText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function toDateOnly(value: unknown): string | null {
  return value ? String(value).slice(0, 10) : null;
}

// Givebutter types some booleans as strings ("true"/"false"), and JS's own
// Boolean("false") is true -- a trap this function exists specifically to
// avoid.
export function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value == null) return false;
  return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
}

// Normalizes any value bound for a single select: trim it, and turn blanks
// into null. Trailing whitespace from an API is invisible in logs and will
// fail a select write even when the value looks identical to an existing
// choice.
export function normalizeSelectText(value: unknown): string | null {
  return value == null ? null : String(value).trim() || null;
}

// Single select WRITE format. The Scripting API wants {name: "..."} or
// {id: "..."} -- a bare string is rejected with "cannot accept the provided
// value", even when the choice exists verbatim.
export function toSelectField(value: unknown): { name: string } | null {
  const text = normalizeSelectText(value);
  return text ? { name: text } : null;
}
