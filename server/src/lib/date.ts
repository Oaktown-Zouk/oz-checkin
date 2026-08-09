// Studio's local YYYY-MM-DD for a given instant (not UTC). Check-ins are scoped to this.
export function dateStringFor(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
