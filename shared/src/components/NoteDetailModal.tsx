import type { NoteDetails } from "../types.js";
import { Portal } from "./Portal.js";

export function NoteDetailModal({
  note,
  onClose,
  onEdit,
}: {
  note: NoteDetails;
  onClose: () => void;
  // Only passed by a caller that's already confirmed the viewer wrote this note (see
  // StudentPage.tsx comparing note.issuerRoleId against the signed-in session's own
  // userRoleId) — omitted entirely means no Edit button, not a disabled one.
  onEdit?: () => void;
}) {
  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog-card note-dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Note from {note.issuerName}</h2>
          <p className="dialog-description">{note.summary}</p>

          {note.strengths && (
            <div className="note-section">
              <div className="note-section-label">Doing well</div>
              <p className="note-section-text">{note.strengths}</p>
            </div>
          )}

          {note.opportunities && (
            <div className="note-section">
              <div className="note-section-label">Should work on</div>
              <p className="note-section-text">{note.opportunities}</p>
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            {onEdit && (
              <button type="button" className="btn btn-primary" onClick={onEdit}>
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
