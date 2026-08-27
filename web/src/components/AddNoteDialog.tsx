import { useState, type FormEvent } from "react";
import { Portal } from "shared";

export function AddNoteDialog({
  studentName,
  onSubmit,
  onClose,
}: {
  studentName: string;
  onSubmit: (summary: string, strengths: string, opportunities: string) => Promise<void>;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [strengths, setStrengths] = useState("");
  const [opportunities, setOpportunities] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!summary.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(summary.trim(), strengths.trim(), opportunities.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save note");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <form className="dialog-card note-dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
          <h2>Add note</h2>

          <label className="dialog-field-label" htmlFor="note-summary">
            Summary
          </label>
          <input
            id="note-summary"
            type="text"
            autoFocus
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />

          <label className="dialog-field-label" htmlFor="note-strengths">
            What {studentName} is doing well:
          </label>
          <textarea id="note-strengths" rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} />

          <label className="dialog-field-label" htmlFor="note-opportunities">
            What {studentName} should work on:
          </label>
          <textarea
            id="note-opportunities"
            rows={3}
            value={opportunities}
            onChange={(e) => setOpportunities(e.target.value)}
          />

          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !summary.trim()}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
