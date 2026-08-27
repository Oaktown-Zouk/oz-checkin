import { useEffect, useRef, useState } from "react";

export type StudentView = "progress" | "qr";

// Same hamburger + dropdown shell as web/src/components/NavMenu.tsx, minus the
// permission gating (a Student session carries no permissions to check — see
// server/src/studentApp.ts) and switching a local view instead of navigating to a
// different page, since this app has no routing. Unlike the staff version, this is
// the app's only top-of-page control — Log out lives here too instead of its own
// separate button, and it sits inline in the page flow rather than fixed-position.
export function NavMenu({
  current,
  onNavigate,
  onLogout,
}: {
  current: StudentView;
  onNavigate: (view: StudentView) => void;
  onLogout: () => void;
}) {
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

  const items: { label: string; view: StudentView }[] = [
    { label: "My Progress", view: "progress" },
    { label: "QR Code", view: "qr" },
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
              key={item.view}
              type="button"
              className={item.view === current ? "nav-menu-item nav-menu-item-active" : "nav-menu-item"}
              onClick={() => {
                setOpen(false);
                onNavigate(item.view);
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="nav-menu-item nav-menu-item-logout"
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
