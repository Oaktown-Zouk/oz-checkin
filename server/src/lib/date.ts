// Studio's local "today" as YYYY-MM-DD. Check-ins are scoped to this, not a UTC day.
export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
