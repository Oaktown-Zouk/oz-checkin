import type { CheckInInfo, CheckInSelection, StudentStatus } from "./types.js";

// Applied the instant a check-in is submitted, before the write has even reached the
// server — the caller (App.tsx/KioskPage.tsx) reconciles with the real thing once its
// own write-then-read completes, discarding whatever this produced. Deliberately
// approximate: it doesn't replicate server-side credit consumption or review-flagging
// (services/checkins.ts), since those depend on server state this function doesn't
// have — good enough for the brief window until the real read lands, not meant to be
// exact.
export function applyOptimisticCheckin(
  status: StudentStatus,
  selections: CheckInSelection[],
  programNameById: Map<string, string>
): StudentStatus {
  if (selections.length === 0) return status;

  const now = new Date().toISOString();
  const newCheckins: CheckInInfo[] = selections.map((s, i) => ({
    id: `optimistic-${now}-${i}`,
    checkedInAt: now,
    programId: s.programId,
    programName: programNameById.get(s.programId) ?? null,
    role: s.role,
    needsReview: false,
    reviewReason: null,
  }));

  return {
    ...status,
    checkinsToday: [...status.checkinsToday, ...newCheckins],
    checkedInToday: true,
    remaining: status.remaining - selections.length,
  };
}
