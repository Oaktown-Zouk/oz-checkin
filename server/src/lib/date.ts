// The studio operates in Pacific time; every date-sensitive Airtable formula this app
// reads (Remaining Today, Is Counted, etc.) is explicitly zoned to it too. This app
// itself runs on Netlify Functions (effectively UTC), not a front-desk laptop in the
// studio's own timezone like the old app did — so "today" must be computed from this
// timezone, never the server's local one, or evening Pacific hours (after UTC has
// already rolled to the next calendar day) would silently break "today" everywhere.
export const STUDIO_TIMEZONE = "America/Los_Angeles";

// Studio-local YYYY-MM-DD for a given instant. Check-ins are scoped to this.
export function dateStringFor(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIMEZONE }).format(d);
}

export function today(): string {
  return dateStringFor(new Date());
}

export function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
