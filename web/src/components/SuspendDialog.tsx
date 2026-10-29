import { useState } from "react";
import type { StudentStatus } from "../api.js";
import { Portal } from "shared";

// Confirms a Suspend or Unsuspend from the roster's Actions menu — whichever applies
// to the student's current state. See server/src/services/suspension.ts.
export function SuspendDialog({
  student,
  onSubmit,
  onClose,
}: {
  student: StudentStatus;
  onSubmit: () => Promise<void>;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = student.suspended ? "Unsuspend" : "Suspend";

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${verb} failed`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
          <h2>
            {verb} {student.name}?
          </h2>
          <p>
            {student.suspended
              ? "They'll be able to check in again, at the front desk and the kiosk."
              : "They'll be hidden from the kiosk and blocked from checking in at the front desk."}
          </p>
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Saving…" : verb}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
