import { useState } from "react";
import { type CheckInSelection, type ProgramSchedule, type StudentStatus } from "../api.js";
import { activeProgramsForDate, hasConflictingSelection, todayInStudioTz, withinVisibleWindow } from "../programSchedule.js";
import { MembershipBadge, Portal } from "shared";

const ROLES = ["Lead", "Follow"] as const;
const WELCOME_MS = 5000;

type RoleByProgram = Record<string, "Lead" | "Follow" | undefined>;

function isDone(student: StudentStatus, programId: string, role: "Lead" | "Follow") {
  return student.checkinsToday.some((c) => c.programId === programId && c.role === role);
}

function isTakenAtAll(student: StudentStatus, programId: string) {
  return student.checkinsToday.some((c) => c.programId === programId);
}

// lastCheckinSelections is already bounded to the student's last 7 days (see
// computeLastCheckinSelections) — used here purely as a visual nudge ("you did this
// last week") rather than to preselect anything, since kiosk check-ins are always an
// explicit pick.
function isFromLastWeek(student: StudentStatus, programId: string, role: "Lead" | "Follow") {
  return student.lastCheckinSelections.some((s) => s.programId === programId && s.role === role);
}

// The self-serve, large-touch-target version of the check-in flow — structurally
// different enough from CheckInDialog (no email/undo/transfer affordances, no
// backdating-eligibility confirm prompt) to warrant its own component rather than a
// shared one with a "kiosk mode" prop. Otherwise the same pick-then-submit shape as
// the front desk: picks are purely local until Done is pressed, and submission itself
// is fire-and-forget — see onSubmit below and KioskPage.tsx's handleCheckIn — so
// pressing Done shows the welcome message right away rather than waiting on the
// network. Shares the same conflict-disabling and visible-window logic via
// programSchedule.ts.
export function KioskCheckInDialog({
  student,
  programs,
  effectiveAt,
  onSubmit,
  onClose,
}: {
  student: StudentStatus;
  programs: ProgramSchedule[];
  // Admin-only "simulate now" override (Backdate Kiosk permission) — see
  // KioskPage.tsx. "" or undefined means live, same convention as the front desk's
  // effectiveAt.
  effectiveAt?: string;
  // Fire-and-forget — the caller starts the write in the background and reconciles
  // its own roster cache once it (and the read that follows it) settle; any failure
  // surfaces later via KioskPage's error banner, not here.
  onSubmit: (selections: CheckInSelection[]) => void;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<RoleByProgram>({});
  const [showWelcome, setShowWelcome] = useState(false);

  const effectiveDate = effectiveAt ? new Date(effectiveAt) : undefined;
  const effectiveDateStr = effectiveAt ? effectiveAt.slice(0, 10) : todayInStudioTz();
  const visiblePrograms = activeProgramsForDate(programs, effectiveDateStr).filter((p) => withinVisibleWindow(p, effectiveDate));

  const selections: CheckInSelection[] = Object.entries(roles)
    .filter((entry): entry is [string, "Lead" | "Follow"] => Boolean(entry[1]))
    .map(([programId, role]) => ({ programId, role }));
  const localRemaining = student.remaining - selections.length;

  function toggle(programId: string, role: "Lead" | "Follow") {
    setRoles((prev) => ({ ...prev, [programId]: prev[programId] === role ? undefined : role }));
  }

  function handleDone() {
    if (selections.length === 0) {
      onClose();
      return;
    }

    onSubmit(selections);
    setShowWelcome(true);
    setTimeout(onClose, WELCOME_MS);
  }

  if (showWelcome) {
    return (
      <Portal>
        <div className="dialog-overlay">
          <div className="kiosk-welcome">
            <div>Welcome to Oaktown Zouk, have a great class!</div>
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

          <div className="remaining-counter remaining-counter-kiosk">
            <span className="remaining-counter-value">{localRemaining}</span>
            <span className="remaining-counter-label">remaining</span>
          </div>

          {visiblePrograms.length === 0 && <p className="dialog-description">No classes available right now.</p>}

          <div className="kiosk-program-list">
            {visiblePrograms.map((p) => {
              // A student can't be in two classes at once — once one program in a
              // timeslot has a role picked (or already checked into today), the
              // others in that same slot are disabled.
              const conflict = hasConflictingSelection(visiblePrograms, p.id, (id) => !!roles[id] || isTakenAtAll(student, id));
              return (
                <div className="kiosk-program-row" key={p.id}>
                  <span className="kiosk-program-name">{p.name}</span>
                  <div className="kiosk-role-buttons">
                    {ROLES.map((role) => {
                      const done = isDone(student, p.id, role);
                      const selected = roles[p.id] === role;
                      const recent = !done && isFromLastWeek(student, p.id, role);
                      return (
                        <button
                          key={role}
                          type="button"
                          className={`kiosk-role-btn${done ? " kiosk-role-btn-done" : ""}${selected ? " kiosk-role-btn-selected" : ""}${recent ? " kiosk-role-btn-recent" : ""}`}
                          disabled={done || conflict}
                          onClick={() => toggle(p.id, role)}
                        >
                          {done ? `✓ ${role}` : role}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" className="btn btn-secondary kiosk-close-btn" onClick={handleDone}>
            {selections.length === 0 ? "Cancel" : `Done (${selections.length})`}
          </button>
        </div>
      </div>
    </Portal>
  );
}
