import { useState } from "react";
import { LevelBadge, Portal } from "shared";

const LEVEL_OPTIONS: (number | null)[] = [null, 1, 2, 3, 4];

export function LevelEditDialog({
  title,
  currentLevel,
  shape,
  onSubmit,
  onClose,
}: {
  title: string;
  currentLevel: number | null;
  shape: "square" | "circle";
  onSubmit: (level: number | null) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(currentLevel);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(selected);
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
        <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
          <h2>{title}</h2>
          <div className="level-options">
            {LEVEL_OPTIONS.map((level) => (
              <button
                type="button"
                key={level ?? "unset"}
                className={`level-option${selected === level ? " level-option-selected" : ""}`}
                onClick={() => setSelected(level)}
              >
                <span className="level-option-icon">
                  <LevelBadge level={level} shape={shape} />
                </span>
                <span className="level-option-label">{level === null ? "Unset" : `Level ${level}`}</span>
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
