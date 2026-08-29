import { listStudentStatuses } from "./studentStatus.js";

export interface KioskRosterEntry {
  id: string;
  name: string;
  membershipStatus: string;
  availableCredits: number;
  remaining: number;
}

// One lightweight snapshot of *every* student (not just eligible ones), meant to be
// fetched once and cached client-side by the kiosk page so name search runs locally
// — no per-keystroke round trip. Still missing email/tier/badges (no reason to ship
// those to a physically-accessible tablet), but full names are fine — the studio is
// comfortable with a shared roster view of names, same as other studio-management
// tools (e.g. MyStudio) already show.
export async function listKioskRoster(date?: string): Promise<KioskRosterEntry[]> {
  const statuses = await listStudentStatuses({ date });
  return statuses.map((s) => ({
    id: s.id,
    name: s.name,
    membershipStatus: s.membershipStatus,
    availableCredits: s.availableCredits,
    remaining: s.remaining,
  }));
}
