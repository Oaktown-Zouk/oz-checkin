import { useState, type FormEvent } from "react";
import type { StudentStatus } from "../api.js";
import { Portal } from "shared";

// Preferred Name is folded into Full Name by Airtable's own formula ("First
// (Preferred) Last"), so submitting here is the only write needed for it to show up
// everywhere the app already displays this student's name — see
// server/src/airtable/fields.ts's MemberFields.
export function PreferredNameDialog({
  student,
  onSubmit,
  onClose,
}: {
  student: StudentStatus;
  onSubmit: (preferredName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(student.preferredName ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <form className="dialog-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
          <h2>Set preferred name for {student.name}</h2>
          <input
            type="text"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Leave blank to clear"
          />
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
