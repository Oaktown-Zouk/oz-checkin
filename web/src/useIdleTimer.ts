import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "touchstart", "keydown", "wheel", "scroll"] as const;

// Resets the kiosk to a given screen after a stretch of no activity — these
// sign-up/purchase screens sit on a public, unattended tablet, so anything left on
// screen (a contact form, a payment widget) needs to time itself back to the kiosk
// home rather than sit there indefinitely for the next person to stumble onto.
//
// `focusContainerRef`, when given, is polled once a second — while focus sits
// anywhere inside it, that counts as activity too. This exists for the embedded
// Givebutter widgets: they're expected to render as a cross-origin iframe, so this
// page's own click/keydown listeners can never see interactions *inside* it, only
// that focus has moved there — which is the most either can observe of a third-party
// embed. See KioskPurchaseFlow.tsx's WIDGET_IDLE_MS for the tradeoff this implies.
export function useIdleTimer(timeoutMs: number, onIdle: () => void, focusContainerRef?: React.RefObject<HTMLElement>): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function reset() {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    }
    reset();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true });

    const pollId = focusContainerRef
      ? setInterval(() => {
          if (focusContainerRef.current?.contains(document.activeElement)) reset();
        }, 1000)
      : undefined;

    return () => {
      clearTimeout(timer);
      if (pollId) clearInterval(pollId);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [timeoutMs, focusContainerRef]);
}
