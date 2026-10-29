import { Portal, SUSPENDED_MESSAGE } from "shared";

// Shown by the front desk's Check In for a suspended student, in place of
// CheckInDialog.
export function SuspendedDialog({ onClose }: { onClose: () => void }) {
  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
          <p className="suspended-message">{SUSPENDED_MESSAGE}</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" autoFocus onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
