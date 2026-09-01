import { useState } from "react";
import { type CheckInSelection, type ProgramSchedule, type StudentStatus } from "../api.js";
import {
  activeProgramsForDate,
  isCheckedInToday,
  isProgramCheckedInToday,
  timeslotGroup,
  todayInStudioTz,
  withinVisibleWindow,
} from "../programSchedule.js";
import { MembershipBadge, Portal } from "shared";
import chimeUrl from "../../assets/bell_g5.opus";

const ROLES = ["Lead", "Follow"] as const;
const WELCOME_MS = 5000;
const CHIME_INTERVAL_MS = 700;

// One chime per class checked in, 0.7s apart — deliberately shorter than the clip
// itself, so consecutive chimes overlap rather than waiting for each other to finish.
// A new Audio instance per play (rather than reusing one) is what makes that
// possible: each instance has its own playback position, so they can ring
// simultaneously instead of one cutting the other off. play() can reject (e.g. no
// audio hardware, or the browser being unusually strict about it despite this always
// being called from a direct tap) — a missed chime isn't worth surfacing an error
// over, so this swallows that failure and just stops repeating.
function playChime(timesRemaining: number) {
  if (timesRemaining <= 0) return;
  new Audio(chimeUrl).play().catch(() => {});
  if (timesRemaining > 1) setTimeout(() => playChime(timesRemaining - 1), CHIME_INTERVAL_MS);
}

type RoleByProgram = Record<string, "Lead" | "Follow" | undefined>;

// lastCheckinSelections is already bounded to the student's last 29 days (see
// computeLastCheckinSelections) — used here purely as a visual nudge ("you did this
// recently") rather than to preselect anything, since kiosk check-ins are always an
// explicit pick.
function isRecentSelection(student: StudentStatus, programId: string, role: "Lead" | "Follow") {
  return student.lastCheckinSelections.some((s) => s.programId === programId && s.role === role);
}

// The self-serve, large-touch-target version of the check-in flow — structurally
// different enough from CheckInDialog (no email/undo/transfer affordances, no
// backdating-eligibility confirm prompt) to warrant its own component rather than a
// shared one with a "kiosk mode" prop. Otherwise the same pick-then-submit shape as
// the front desk, separate Cancel/Check In buttons included (Check In disabled until
// at least one class is picked, Cancel always closes with no submission — e.g. a
// student who started picking classes for the wrong person): picks are purely local
// until Check In is pressed, and submission itself is fire-and-forget — see onSubmit
// below and KioskPage.tsx's handleCheckIn — so pressing Check In shows the welcome
// message right away rather than waiting on the network. Shares the same
// conflict-graying and visible-window logic via programSchedule.ts.
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
  // Unlike the front desk dialog, the kiosk shows one merged number a drop-in
  // student can act on directly: student.remaining already accounts for membership
  // allowance minus today's check-ins (see studentStatus.ts), so adding
  // availableCredits folds in a drop-in credit pool the same way. Capped by how many
  // distinct class timeslots are still visible today — credits/allowance can't let a
  // student check into more classes than actually exist to check into.
  const timeslotsAvailableToday = new Set(visiblePrograms.map((p) => p.startTime)).size;
  const localRemaining = Math.min(
    student.remaining + student.availableCredits - selections.length,
    timeslotsAvailableToday
  );

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
      const group = timeslotGroup(visiblePrograms, programId);
      const next: RoleByProgram = {};
      for (const [pid, r] of Object.entries(prev)) {
        if (!group.some((g) => g.id === pid)) next[pid] = r;
      }
      next[programId] = role;
      return next;
    });
  }

  function handleCheckIn() {
    onSubmit(selections);
    playChime(selections.length);
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
            <MembershipBadge student={student} showBothWhenApplicable />
          </div>

          <div className="remaining-counter remaining-counter-kiosk">
            <span className="remaining-counter-value">{localRemaining}</span>
            <span className="remaining-counter-label">remaining</span>
          </div>

          {visiblePrograms.length === 0 && <p className="dialog-description">No classes available right now.</p>}

          <div className="kiosk-program-list">
            {visiblePrograms.map((p) => {
              const group = timeslotGroup(visiblePrograms, p.id);
              // If any class in this timeslot already has a real check-in today, the
              // whole group is locked — that choice was already made and can't be
              // changed here. Otherwise, a pending local pick anywhere in the group
              // just grays out the rest of the group rather than disabling it —
              // tapping one of them switches the pick.
              const groupCommitted = group.some((g) => isProgramCheckedInToday(student, g.id));
              const pickedProgramId = group.find((g) => roles[g.id])?.id;
              return (
                <div className="kiosk-program-row" key={p.id}>
                  <span className="kiosk-program-name">{p.name}</span>
                  <div className="kiosk-role-buttons">
                    {ROLES.map((role) => {
                      const done = isCheckedInToday(student, p.id, role);
                      const selected = roles[p.id] === role;
                      const grayed = !groupCommitted && pickedProgramId !== undefined && !selected;
                      const recent = !done && isRecentSelection(student, p.id, role);
                      return (
                        <button
                          key={role}
                          type="button"
                          className={`kiosk-role-btn${done ? " kiosk-role-btn-done" : ""}${selected ? " kiosk-role-btn-selected" : ""}${grayed ? " kiosk-role-btn-grayed" : ""}${recent ? " kiosk-role-btn-recent" : ""}`}
                          disabled={groupCommitted}
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

          <div className="kiosk-dialog-actions">
            <button type="button" className="btn btn-secondary kiosk-close-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary kiosk-close-btn"
              onClick={handleCheckIn}
              disabled={selections.length === 0}
            >
              {`Check In (${selections.length})`}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
