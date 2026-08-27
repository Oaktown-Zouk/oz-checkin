import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// Renders straight into document.body instead of wherever the caller sits in the DOM
// tree. Dialogs need this: a modal opened from inside a dimmed/opacity'd row (e.g. a
// checked-in student row, or the kiosk's muted "Backdate check-ins" corner link) would
// otherwise inherit that ancestor's opacity — CSS opacity applies to an element's whole
// rendered subtree and can't be undone by a child's own `opacity: 1`, even for a
// `position: fixed` overlay. Escaping to body sidesteps that (and any future
// overflow/transform/z-index containment issues) entirely.
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
