import { useState } from "react";
import { api, ApiError, type ProgramSchedule, type StudentStatus } from "../api.js";
import { activeProgramsForDate, hasConflictingSelection, todayInStudioTz, withinVisibleWindow } from "../programSchedule.js";
import { MembershipBadge } from "./MembershipBadge.js";
import { Portal } from "./Portal.js";

const ROLES = ["Lead", "Follow"] as const;
const WELCOME_MS = 5000;

function isDone(student: StudentStatus, programId: string, role: "Lead" | "Follow") {
  return student.checkinsToday.some((c) => c.programId === programId && c.role === role);
}

function isTakenAtAll(student: StudentStatus, programId: string) {
  return student.checkinsToday.some((c) => c.programId === programId);
}

// The self-serve, large-touch-target version of the check-in flow — structurally
// different enough from CheckInDialog (immediate per-tap check-in vs. pick-then-
// submit, no email/undo/transfer affordances at all) to warrant its own component
// rather than a shared one with a "kiosk mode" prop. Shares the same conflict-
// disabling and visible-window logic via programSchedule.ts.
export function KioskCheckInDialog({
  student: initialStudent,
  programs,
  effectiveAt,
  onClose,
}: {
  student: StudentStatus;
  programs: ProgramSchedule[];
  // Admin-only "simulate now" override (Backdate Kiosk permission) — see
  // KioskPage.tsx. "" or undefined means live, same convention as the front desk's
  // effectiveAt.
  effectiveAt?: string;
  onClose: () => void;
}) {
  const [student, setStudent] = useState(initialStudent);
  const [checkedInAny, setCheckedInAny] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // "programId_role" mid-request
  const [error, setError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  const effectiveDate = effectiveAt ? new Date(effectiveAt) : undefined;
  const effectiveDateStr = effectiveAt ? effectiveAt.slice(0, 10) : todayInStudioTz();
  const visiblePrograms = activeProgramsForDate(programs, effectiveDateStr).filter((p) => withinVisibleWindow(p, effectiveDate));

  function closeWithWelcome() {
    setShowWelcome(true);
    setTimeout(onClose, WELCOME_MS);
  }

  async function handleTap(programId: string, role: "Lead" | "Follow") {
    setPending(`${programId}_${role}`);
    setError(null);
    try {
      // Uses POST /api/checkins' own returned status directly — GET
      // /api/kiosk/students/:id is eligibility-gated, and using up the student's last
      // credit/allowance (which this tap might just have done) is exactly what makes
      // them stop being kiosk-eligible, so that endpoint isn't safe to rely on here.
      const updated = await api.checkIn(student.id, [{ programId, role }], effectiveDate?.toISOString());
      setStudent(updated);
      setCheckedInAny(true);

      const allocationExhausted = updated.remaining <= 0 && updated.availableCredits <= 0;
      const anyTappableLeft = visiblePrograms.some((p) =>
        ROLES.some((r) => !isDone(updated, p.id, r) && !hasConflictingSelection(visiblePrograms, p.id, (id) => isTakenAtAll(updated, id)))
      );
      if (allocationExhausted || !anyTappableLeft) closeWithWelcome();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Check-in failed — please try again.");
    } finally {
      setPending(null);
    }
  }

  if (showWelcome) {
    return (
      <Portal>
        <div className="dialog-overlay">
          <div className="kiosk-welcome">
            <div>Welcome {student.name}!</div>
            <div>Have a great class!</div>
          </div>
        </div>
      </Portal>
    );
  }

  return (
    <Portal>
      <div className="dialog-overlay">
        <div className="kiosk-dialog-card">
          <h1 className="kiosk-dialog-title">{student.name}</h1>
          <div className="badges">
            <MembershipBadge student={student} />
          </div>

          {visiblePrograms.length === 0 && <p className="dialog-description">No classes available right now.</p>}

          <div className="kiosk-program-list">
            {visiblePrograms.map((p) => {
              const conflict = hasConflictingSelection(visiblePrograms, p.id, (id) => isTakenAtAll(student, id));
              return (
                <div className="kiosk-program-row" key={p.id}>
                  <span className="kiosk-program-name">{p.name}</span>
                  <div className="kiosk-role-buttons">
                    {ROLES.map((role) => {
                      const done = isDone(student, p.id, role);
                      const key = `${p.id}_${role}`;
                      return (
                        <button
                          key={role}
                          type="button"
                          className={`kiosk-role-btn${done ? " kiosk-role-btn-done" : ""}`}
                          disabled={done || conflict || pending !== null}
                          onClick={() => handleTap(p.id, role)}
                        >
                          {pending === key ? "…" : done ? `✓ ${role}` : role}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {error && <p className="error">{error}</p>}

          <button type="button" className="btn btn-secondary kiosk-close-btn" onClick={onClose}>
            {checkedInAny ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </Portal>
  );
}
