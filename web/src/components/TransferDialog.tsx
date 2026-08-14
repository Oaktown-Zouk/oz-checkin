import { useState, type FormEvent } from "react";
import type { StudentStatus } from "../api.js";

interface TransferableItem {
  kind: "membership" | "payment";
  id: number;
  label: string;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// A student can hold more than one membership (that's the whole scenario transfers
// exist for — someone buys a second one for someone else) and more than one unredeemed
// credit, so this offers every transferable item, not just the primary one shown
// elsewhere. Already-redeemed credits are excluded — there's nothing left to transfer.
function transferableItems(student: StudentStatus): TransferableItem[] {
  return [
    ...student.heldMemberships.map((m) => ({
      kind: "membership" as const,
      id: m.id,
      label: `Membership (${m.status}${
        m.amountCents ? `, ${formatDollars(m.amountCents)}/${m.frequency ?? "period"}` : ""
      })`,
    })),
    ...(student.credits?.payments ?? [])
      .filter((p) => !p.redeemed)
      .map((p) => ({
        kind: "payment" as const,
        id: p.id,
        label: `One-time credit (${formatDollars(p.amountCents)}, paid ${new Date(
          p.paidAt
        ).toLocaleDateString()})`,
      })),
  ];
}

export function TransferDialog({
  student,
  onSubmit,
  onClose,
}: {
  student: StudentStatus;
  onSubmit: (kind: "membership" | "payment", itemId: number, targetEmail: string) => Promise<void>;
  onClose: () => void;
}) {
  const items = transferableItems(student);
  const [selectedKey, setSelectedKey] = useState(
    items[0] ? `${items[0].kind}:${items[0].id}` : ""
  );
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = items.find((i) => `${i.kind}:${i.id}` === selectedKey) ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(selected.kind, selected.id, email.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <form className="dialog-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Transfer membership or credit</h2>
        {items.length === 0 ? (
          <p className="dialog-description">
            {student.name} doesn't have a membership or unredeemed credit to transfer right now.
          </p>
        ) : (
          <>
            <p className="dialog-description">
              Move a membership or unredeemed credit from {student.name} to a different
              student — e.g. they bought it for someone else.
            </p>
            <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
              {items.map((item) => (
                <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                  {item.label}
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
          {items.length > 0 && (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !email.trim() || !selected}
            >
              {submitting ? "Transferring…" : "Transfer"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
