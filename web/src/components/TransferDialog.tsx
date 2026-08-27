import { useEffect, useState, type FormEvent } from "react";
import { api, type HeldMembership, type StudentStatus } from "../api.js";
import { Portal } from "shared";

function formatMembership(m: HeldMembership): string {
  const amount = m.amount != null ? `, $${m.amount.toFixed(2)}/${m.frequency ?? "period"}` : "";
  return `Membership (${m.status}${amount})`;
}

export function TransferDialog({
  student,
  onSubmit,
  onClose,
}: {
  student: StudentStatus;
  onSubmit: (planId: string, targetEmail: string) => Promise<void>;
  onClose: () => void;
}) {
  const [memberships, setMemberships] = useState<HeldMembership[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .heldMemberships(student.id)
      .then((items) => {
        setMemberships(items);
        if (items[0]) setSelectedId(items[0].id);
      })
      .catch(() => setLoadError("Couldn't load memberships."));
  }, [student.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(selectedId, email.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <form className="dialog-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
          <h2>Transfer membership</h2>

          {memberships === null && !loadError && <p className="dialog-description">Loading…</p>}
          {loadError && <p className="error">{loadError}</p>}
          {memberships && memberships.length === 0 && (
            <p className="dialog-description">
              {student.name} doesn't have a membership to transfer right now.
            </p>
          )}
          {memberships && memberships.length > 0 && (
            <>
              <p className="dialog-description">
                Move a membership from {student.name} to a different student — e.g. they bought it
                for someone else.
              </p>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {memberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatMembership(m)}
                  </option>
                ))}
              </select>
              <input
                type="email"
                autoFocus
                placeholder="recipient@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </>
          )}

          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            {memberships && memberships.length > 0 && (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !email.trim() || !selectedId}
              >
                {submitting ? "Transferring…" : "Transfer"}
              </button>
            )}
          </div>
        </form>
      </div>
    </Portal>
  );
}
