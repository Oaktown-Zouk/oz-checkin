import { useState, type FormEvent } from "react";
import { Portal } from "shared";

export function BackdateDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value) return;
    onSubmit(value);
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <form className="dialog-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
          <h2>Backdate check-ins</h2>
          <p className="dialog-description">
            Pick a date and time to view and correct check-ins for a past day. The page will
            show that day's status, and any check-ins you make will be stamped with this time.
          </p>
          <input
            type="datetime-local"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!value}>
              Start
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
