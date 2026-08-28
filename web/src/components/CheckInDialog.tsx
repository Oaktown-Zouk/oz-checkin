import { Fragment, useMemo, useState } from "react";
import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { activeProgramsForDate, isCheckedInToday, isProgramCheckedInToday, timeslotGroup, todayInStudioTz } from "../programSchedule.js";
import { MembershipBadge, Portal } from "shared";

type RoleByProgram = Record<string, "Lead" | "Follow" | undefined>;

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
  // Fire-and-forget — the caller starts the write in the background and reconciles
  // the roster once it (and the read that follows it) settle; see App.tsx's
  // handleCheckIn. This dialog never waits on it, so it can close immediately.
  onSubmit: (selections: CheckInSelection[]) => void;
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
      if (!activeIds.has(s.programId) || isCheckedInToday(student, s.programId, s.role)) continue;
      // Guard against historical data (e.g. a Backfill import) predating this
      // one-pick-per-timeslot rule — never seed two picks in the same group even if
      // a past visit's own records somehow have them.
      const group = timeslotGroup(activePrograms, s.programId);
      if (group.some((g) => g.id in initial)) continue;
      initial[s.programId] = s.role;
    }
    return initial;
  });

  // Only one {class, role} pick allowed per timeslot — a student can't be in two
  // classes at once, or dance one class as both Lead and Follow at once. Picking a
  // new one in a slot replaces whatever was picked elsewhere in that same slot
  // (including a different role for the same class) rather than adding to it.
  function toggle(programId: string, role: "Lead" | "Follow") {
    setRoles((prev) => {
      if (prev[programId] === role) {
        const next = { ...prev };
        delete next[programId];
        return next;
      }
      const group = timeslotGroup(activePrograms, programId);
      const next: RoleByProgram = {};
      for (const [pid, r] of Object.entries(prev)) {
        if (!group.some((g) => g.id === pid)) next[pid] = r;
      }
      next[programId] = role;
      return next;
    });
  }

  const selections: CheckInSelection[] = Object.entries(roles)
    .filter((entry): entry is [string, "Lead" | "Follow"] => Boolean(entry[1]))
    .map(([programId, role]) => ({ programId, role }));

  // Purely a local preview of what remaining will become once these picks are
  // submitted — recomputed from student.remaining on every render, not a separate
  // piece of state, so it can never drift from the selections that produce it.
  const localRemaining = student.remaining - selections.length;

  function handleSubmit() {
    if (selections.length === 0) return;

    // A heads-up before submitting, not a hard block — the server allows the check-in
    // either way (consuming a credit or flagging it for review).
    if (student.remaining <= 0 && student.availableCredits === 0) {
      const ok = window.confirm(
        `${student.name} has no remaining classes or credits today. Check in anyway? (will be flagged for review)`
      );
      if (!ok) return;
    }

    // Doesn't wait for the write — the dialog closes immediately, and any failure
    // surfaces later via the page-level error banner (see App.tsx), not here.
    onSubmit(selections);
    onClose();
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

          <div className="remaining-counter">
            <span className="remaining-counter-value">{localRemaining}</span>
            <span className="remaining-counter-label">remaining</span>
          </div>

          {activePrograms.length === 0 && <p className="dialog-description">No classes scheduled for this day.</p>}

          {activePrograms.length > 0 && (
            <div className="program-picker">
              {activePrograms.map((p, i) => {
                const group = timeslotGroup(activePrograms, p.id);
                // If any class in this timeslot already has a real check-in today, the
                // whole group is locked — that choice was already made and can't be
                // changed here (Undo is the only way back). Otherwise, a pending local
                // pick anywhere in the group just grays out the rest of the group
                // rather than disabling it — clicking one of them switches the pick.
                const groupCommitted = group.some((g) => isProgramCheckedInToday(student, g.id));
                const pickedProgramId = group.find((g) => roles[g.id])?.id;
                const showDivider = i > 0 && p.startTime !== activePrograms[i - 1].startTime;

                return (
                  <Fragment key={p.id}>
                    {showDivider && <hr className="program-picker-divider" />}
                    <div className={`program-picker-row${groupCommitted ? " program-picker-row-disabled" : ""}`}>
                      <span className="program-picker-name">{p.name}</span>
                      <div className="program-picker-roles">
                        {(["Lead", "Follow"] as const).map((role) => {
                          const done = isCheckedInToday(student, p.id, role);
                          const isSelected = roles[p.id] === role;
                          const grayed = !groupCommitted && pickedProgramId !== undefined && !isSelected;
                          return (
                            <button
                              key={role}
                              type="button"
                              className={`role-toggle${isSelected ? " role-toggle-selected" : ""}${done ? " role-toggle-done" : ""}${grayed ? " role-toggle-grayed" : ""}`}
                              disabled={groupCommitted}
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

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {activePrograms.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={selections.length === 0}>
                {`Check in (${selections.length})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
