// The studio operates in Pacific time; every date-sensitive Airtable formula this app
// reads (Remaining Today, Is Counted, etc.) is explicitly zoned to it too. This app
// runs on Netlify Functions, whose host clock is effectively UTC, not the studio's own
// timezone — so "today" must always be computed from this constant, never the
// server's local one, or evening Pacific hours (after UTC has already rolled to the
// next calendar day) would silently break "today" everywhere.
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

// Studio-local YYYY-MM-DD for n days before now — used to bound a filterByFormula to
// "recent" instead of a table's entire history. A day or so of fuzziness around
// midnight from doing the subtraction in UTC before localizing doesn't matter here;
// this is a performance window, not a precise cutoff.
export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return dateStringFor(d);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
