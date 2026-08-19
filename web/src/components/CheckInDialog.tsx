import { useMemo, useState } from "react";
import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { activeProgramsForDate, todayInStudioTz } from "../programSchedule.js";

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
  onSubmit: (selections: CheckInSelection[]) => Promise<void>;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<RoleByProgram>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activePrograms = useMemo(
    () => activeProgramsForDate(programs, effectiveDate ?? todayInStudioTz()),
    [programs, effectiveDate]
  );

  function toggle(programId: string, role: "Lead" | "Follow") {
    setRoles((prev) => ({ ...prev, [programId]: prev[programId] === role ? undefined : role }));
  }

  const selections: CheckInSelection[] = Object.entries(roles)
    .filter((entry): entry is [string, "Lead" | "Follow"] => Boolean(entry[1]))
    .map(([programId, role]) => ({ programId, role }));

  async function handleSubmit() {
    if (selections.length === 0) return;

    // Mirrors the old app's "no payment on file, confirm anyway" pattern — the server
    // always allows the check-in either way (consuming a credit or flagging for
    // review), this is just a heads-up before it happens.
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
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2>Check in {student.name}</h2>

        {activePrograms.length === 0 && <p className="dialog-description">No classes scheduled for this day.</p>}

        {activePrograms.length > 0 && (
          <div className="program-picker">
            {activePrograms.map((p) => (
              <div key={p.id} className="program-picker-row">
                <span className="program-picker-name">{p.name}</span>
                <div className="program-picker-roles">
                  <button
                    type="button"
                    className={`role-toggle${roles[p.id] === "Lead" ? " role-toggle-selected" : ""}`}
                    onClick={() => toggle(p.id, "Lead")}
                  >
                    Lead
                  </button>
                  <button
                    type="button"
                    className={`role-toggle${roles[p.id] === "Follow" ? " role-toggle-selected" : ""}`}
                    onClick={() => toggle(p.id, "Follow")}
                  >
                    Follow
                  </button>
                </div>
              </div>
            ))}
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
  );
}
