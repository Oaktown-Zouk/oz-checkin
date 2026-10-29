import { useEffect, useRef, useState } from "react";

// The "⋮" dropdown at the end of each roster row (see StudentRow.tsx) — a generic
// overflow menu for row-level actions that don't warrant their own button. Closes
// itself on an outside click. With `label`, the trigger is a labeled button instead
// (e.g. StudentPage.tsx's "Actions").
export function RowMenu({ items, label }: { items: { label: string; onClick: () => void }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      {label ? (
        <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {label} ▾
        </button>
      ) : (
        <button
          type="button"
          className="row-menu-trigger"
          aria-label="More actions"
          onClick={() => setOpen((v) => !v)}
        >
          ⋮
        </button>
      )}
      {open && (
        <div className={`row-menu-dropdown${label ? " row-menu-dropdown-left" : ""}`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="row-menu-item"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
