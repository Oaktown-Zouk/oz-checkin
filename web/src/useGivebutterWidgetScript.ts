import { useEffect } from "react";
import { GIVEBUTTER_WIDGET_SCRIPT_SRC } from "shared";

// Injects Givebutter's widget-loader script once per document — it defines the
// <givebutter-widget> custom element that KioskPurchaseFlow renders. Idempotent
// (checks for an existing tag first) since several screens mount this independently
// as the kiosk navigates between them; no cleanup on unmount, since removing it
// would risk breaking a widget instance still on screen when navigating back and
// forth, and Custom Elements auto-upgrade any already-present tags once the script
// actually loads, so load order relative to rendering doesn't matter.
export function useGivebutterWidgetScript(): void {
  useEffect(() => {
    if (document.querySelector(`script[src="${GIVEBUTTER_WIDGET_SCRIPT_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = GIVEBUTTER_WIDGET_SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }, []);
}
