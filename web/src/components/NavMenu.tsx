import { useEffect, useRef, useState } from "react";
import { usePermissions } from "../permissions.js";

// Fixed top-left hamburger, present on every page — but only actually renders
// anything for a session that holds more than one destination's permission (i.e.
// both View Student Data and Create Checkins). A session confined to just one of
// those (e.g. a Kiosk-role account) has nowhere else this menu could send it.
export function NavMenu({
  onNavigateFrontDesk,
  onNavigateKiosk,
}: {
  onNavigateFrontDesk: () => void;
  onNavigateKiosk: () => void;
}) {
  const { has } = usePermissions();
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

  if (!has("View Student Data") || !has("Create Checkins")) return null;

  const items = [
    { label: "Front Desk", onClick: onNavigateFrontDesk },
    { label: "Kiosk", onClick: onNavigateKiosk },
  ];

  return (
    <div className="nav-menu" ref={ref}>
      <button type="button" className="nav-menu-trigger" aria-label="Menu" onClick={() => setOpen((v) => !v)}>
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div className="nav-menu-dropdown">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="nav-menu-item"
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
