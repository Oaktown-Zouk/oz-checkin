import { Fragment, useMemo, useState } from "react";
import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { activeProgramsForDate, hasConflictingSelection, todayInStudioTz } from "../programSchedule.js";
import { MembershipBadge, Portal } from "shared";

type RoleByProgram = Record<string, "Lead" | "Follow" | undefined>;

// Mirrors KioskCheckInDialog's isDone/isTakenAtAll — "already checked in today" needs
// the same checked-off + conflict-disabling treatment here, since the front desk can
// check a student in twice for the same class just as easily as a kiosk tap can.
function isDoneToday(student: StudentStatus, programId: string, role: "Lead" | "Follow") {
  return student.checkinsToday.some((c) => c.programId === programId && c.role === role);
}

function isTakenTodayAtAll(student: StudentStatus, programId: string) {
  return student.checkinsToday.some((c) => c.programId === programId);
}

export function CheckInDialog({
  student,
  effectiveDate,
  programs,
  onSubmit,
  onClose,
}: {
  student: StudentStatus;
  // The viewed date (YYYY-MM-DD) when backdating, so the picker shows that day's
  // classes rather than today's — undefined means live/today.
  effectiveDate?: string;
  // Fetched once on load (see App.tsx), not re-fetched here — filtered against the
  // relevant date below instead of asking the server every time the dialog opens.
  programs: ProgramSchedule[];
  onSubmit: (selections: CheckInSelection[]) => Promise<void>;
  onClose: () => void;
}) {
  const viewedDate = effectiveDate ?? todayInStudioTz();

  const activePrograms = useMemo(() => activeProgramsForDate(programs, viewedDate), [programs, viewedDate]);

  // Preselects whatever the student picked their most recent visit (computed once as
  // part of the roster fetch — see StudentStatus.lastCheckinSelections — not a fetch
  // triggered by opening this dialog, and not backdating-aware: always the true most
  // recent visit regardless of viewedDate). Only applied to programs still on this
  // day's active schedule; anything else from that visit is silently dropped.
  const [roles, setRoles] = useState<RoleByProgram>(() => {
    const activeIds = new Set(activePrograms.map((p) => p.id));
    const initial: RoleByProgram = {};
    for (const s of student.lastCheckinSelections) {
      // Skip a program+role the student is already checked into today (lastCheckinSelections
      // can reflect today's own visit) — that's rendered as done/disabled below, not
      // preselected as if still pending.
      if (activeIds.has(s.programId) && !isDoneToday(student, s.programId, s.role)) initial[s.programId] = s.role;
    }
    return initial;
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(programId: string, role: "Lead" | "Follow") {
    setRoles((prev) => ({ ...prev, [programId]: prev[programId] === role ? undefined : role }));
  }

  const selections: CheckInSelection[] = Object.entries(roles)
    .filter((entry): entry is [string, "Lead" | "Follow"] => Boolean(entry[1]))
    .map(([programId, role]) => ({ programId, role }));

  async function handleSubmit() {
    if (selections.length === 0) return;

    // A heads-up before submitting, not a hard block — the server allows the check-in
    // either way (consuming a credit or flagging it for review).
    if (student.remaining <= 0 && student.availableCredits === 0) {
      const ok = window.confirm(
        `${student.name} has no remaining classes or credits today. Check in anyway? (will be flagged for review)`
      );
      if (!ok) return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(selections);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
          <h2>Check in {student.name}</h2>

          {/* Shows remaining classes/credits while picking, so front desk can see at a
              glance how many the student has left before checking them into more. */}
          <div className="badges">
            <MembershipBadge student={student} />
          </div>

          {activePrograms.length === 0 && <p className="dialog-description">No classes scheduled for this day.</p>}

          {activePrograms.length > 0 && (
            <div className="program-picker">
              {activePrograms.map((p, i) => {
                // A student can't be in two classes at once — once one program in a
                // timeslot has a role picked (or already checked into today), the others
                // in that same slot are disabled (not just visually; the toggle handlers
                // below never fire for them).
                const conflictSelected = hasConflictingSelection(
                  activePrograms,
                  p.id,
                  (id) => !!roles[id] || isTakenTodayAtAll(student, id)
                );
                const showDivider = i > 0 && p.startTime !== activePrograms[i - 1].startTime;

                return (
                  <Fragment key={p.id}>
                    {showDivider && <hr className="program-picker-divider" />}
                    <div className={`program-picker-row${conflictSelected ? " program-picker-row-disabled" : ""}`}>
                      <span className="program-picker-name">{p.name}</span>
                      <div className="program-picker-roles">
                        {(["Lead", "Follow"] as const).map((role) => {
                          const done = isDoneToday(student, p.id, role);
                          return (
                            <button
                              key={role}
                              type="button"
                              className={`role-toggle${roles[p.id] === role ? " role-toggle-selected" : ""}${done ? " role-toggle-done" : ""}`}
                              disabled={done || conflictSelected}
                              onClick={() => toggle(p.id, role)}
                            >
                              {done ? `✓ ${role}` : role}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}

          {submitError && <p className="error">{submitError}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            {activePrograms.length > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={submitting || selections.length === 0}
              >
                {submitting ? "Checking in…" : `Check in (${selections.length})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
