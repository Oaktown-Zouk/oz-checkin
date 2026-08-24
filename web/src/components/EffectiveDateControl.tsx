import { useState } from "react";
import { BackdateDialog } from "./BackdateDialog.js";

export function EffectiveDateControl({
  value,
  onChange,
}: {
  value: string; // datetime-local string; "" means live (now)
  onChange: (value: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!value) {
    return (
      <>
        <button type="button" className="link-button" onClick={() => setDialogOpen(true)}>
          Backdate check-ins
        </button>
        {dialogOpen && (
          <BackdateDialog
            onSubmit={(v) => {
              onChange(v);
              setDialogOpen(false);
            }}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="effective-date-control">
      <label htmlFor="effective-at">Editing as of</label>
      <input
        id="effective-at"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
