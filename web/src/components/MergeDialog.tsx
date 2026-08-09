import { useState, type FormEvent } from "react";

export function MergeDialog({
  studentName,
  onSubmit,
  onClose,
}: {
  studentName: string;
  onSubmit: (otherEmail: string) => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(email.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form className="dialog-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Merge info</h2>
        <p className="dialog-description">
          Combine {studentName}'s record with another email address — e.g. a Google Forms
          waiver signed under one email and a Givebutter payment under another.
        </p>
        <input
          type="email"
          autoFocus
          placeholder="the.other@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || !email.trim()}>
            {submitting ? "Merging…" : "Merge"}
          </button>
        </div>
      </form>
    </div>
  );
}
