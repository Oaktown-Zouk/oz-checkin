// A page-level banner for errors from background/optimistic writes (see
// optimisticCheckin.ts) — these fail after the UI has already moved on, so a
// transient inline error has nothing left to attach to. Stays up until the user
// dismisses it rather than auto-hiding, since a failed check-in write needs a human
// to notice and act on it.
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner-message">{message}</span>
      <button type="button" className="error-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
