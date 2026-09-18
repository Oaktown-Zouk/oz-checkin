import { useEffect, useRef, useState } from "react";
import { usePermissions } from "../permissions.js";

// Fixed top-left hamburger, present on every page, for every session — including a
// Kiosk-role account, which holds neither View Student Data nor Create Checkins
// together and so has nowhere the navigation links could send it. That session still
// gets the menu itself (with just Log out inside) rather than a standalone button
// sitting directly in the header: requiring a tap to open the menu before Log out is
// even visible makes it much harder to hit by accident on a public, unattended tablet.
export function NavMenu({
  onNavigateFrontDesk,
  onNavigateKiosk,
  onNavigateKioskPurchaseQr,
  onNavigateKioskSignup,
  onLogout,
}: {
  onNavigateFrontDesk: () => void;
  onNavigateKiosk: () => void;
  // Quick links straight to a specific kiosk screen — e.g. pulling up the "Buy a
  // pass" QR code or starting the new-member sign-up flow for a student standing at
  // the front desk, without detouring through the kiosk's own home screen first.
  onNavigateKioskPurchaseQr: () => void;
  onNavigateKioskSignup: () => void;
  onLogout: () => void;
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

  // A Kiosk-only session (neither permission) sees just Log out below — every other
  // link goes somewhere that session can't reach anyway.
  const canNavigate = has("View Student Data") && has("Create Checkins");
  const items = canNavigate
    ? [
        { label: "Front Desk", onClick: onNavigateFrontDesk },
        { label: "Kiosk", onClick: onNavigateKiosk },
        { label: "Purchase QR Code", onClick: onNavigateKioskPurchaseQr },
        { label: "New Member Signup", onClick: onNavigateKioskSignup },
      ]
    : [];

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
          <button
            type="button"
            className={`nav-menu-item${items.length > 0 ? " nav-menu-item-logout" : ""}`}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
