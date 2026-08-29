import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useGivebutterWidgetScript } from "../useGivebutterWidgetScript.js";
import { useIdleTimer } from "../useIdleTimer.js";
import {
  DROPIN_PRODUCTS,
  MEMBERSHIP_PRODUCTS,
  SIGNUP_PRODUCT,
  type GivebutterProduct,
  type KioskFlowScreen,
} from "../kioskProducts.js";

const FLOW_IDLE_MS = 60_000;
// Longer than the other screens', since this is where the student is actually
// filling out payment details — see useIdleTimer.ts's comment on focusContainerRef
// for why 120s is a hopeful default, not a guaranteed-correct one: it assumes we can
// tell the widget still has focus, which only holds up if it's an iframe (typical
// for a payment form) rather than something that steals focus back out on every
// keystroke. If real-world use shows people getting bumped back to home mid-payment,
// raise this — 5 minutes is a safe, conservative fallback.
const WIDGET_IDLE_MS = 120_000;

const QR_PIXELS = 320;

function KioskFlowShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="kiosk-flow-screen">
      <h1 className="kiosk-flow-title">{title}</h1>
      {children}
      <button type="button" className="btn btn-secondary kiosk-flow-back" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}

function KioskSignupScreen({ onBack }: { onBack: () => void }) {
  useGivebutterWidgetScript();
  useIdleTimer(FLOW_IDLE_MS, onBack);

  return (
    <KioskFlowShell title="Sign up for a free class" onBack={onBack}>
      <div className="kiosk-widget-wrap">
        <givebutter-widget id={SIGNUP_PRODUCT.widgetId} />
      </div>
    </KioskFlowShell>
  );
}

function KioskBuyAPassScreen({
  onBack,
  onSelectDropIn,
  onSelectMembership,
}: {
  onBack: () => void;
  onSelectDropIn: () => void;
  onSelectMembership: () => void;
}) {
  useIdleTimer(FLOW_IDLE_MS, onBack);

  return (
    <KioskFlowShell title="Buy a pass" onBack={onBack}>
      <div className="kiosk-flow-options">
        <button type="button" className="btn btn-primary kiosk-flow-option" onClick={onSelectDropIn}>
          Buy a drop-in
        </button>
        <button type="button" className="btn btn-primary kiosk-flow-option" onClick={onSelectMembership}>
          Start a Membership
        </button>
      </div>
    </KioskFlowShell>
  );
}

function KioskClassCountScreen({
  title,
  onBack,
  onSelect,
}: {
  title: string;
  onBack: () => void;
  onSelect: (count: 1 | 2) => void;
}) {
  useIdleTimer(FLOW_IDLE_MS, onBack);

  return (
    <KioskFlowShell title={title} onBack={onBack}>
      <div className="kiosk-flow-options">
        <button type="button" className="btn btn-primary kiosk-flow-option" onClick={() => onSelect(1)}>
          One
        </button>
        <button type="button" className="btn btn-primary kiosk-flow-option" onClick={() => onSelect(2)}>
          Two
        </button>
      </div>
    </KioskFlowShell>
  );
}

function KioskQrScreen({
  product,
  onBack,
  onPayOnTablet,
  onIdle,
}: {
  product: GivebutterProduct;
  onBack: () => void;
  onPayOnTablet: () => void;
  onIdle: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useIdleTimer(FLOW_IDLE_MS, onIdle);

  useEffect(() => {
    if (!product.qrUrl) return;
    let cancelled = false;
    QRCode.toDataURL(product.qrUrl, { errorCorrectionLevel: "H", margin: 2, width: QR_PIXELS }).then(
      (url) => {
        if (!cancelled) setDataUrl(url);
      },
      () => {
        if (!cancelled) setDataUrl(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [product.qrUrl]);

  return (
    <KioskFlowShell title="Scan QR code to buy on your phone" onBack={onBack}>
      {dataUrl ? (
        <img src={dataUrl} alt="QR code to complete your purchase on Givebutter" className="kiosk-qr-image" />
      ) : (
        <p className="dialog-description">Loading QR code…</p>
      )}
      <button type="button" className="btn btn-secondary" onClick={onPayOnTablet}>
        Or pay on this tablet
      </button>
    </KioskFlowShell>
  );
}

function KioskWidgetScreen({ product, onBack, onIdle }: { product: GivebutterProduct; onBack: () => void; onIdle: () => void }) {
  useGivebutterWidgetScript();
  const containerRef = useRef<HTMLDivElement>(null);
  useIdleTimer(WIDGET_IDLE_MS, onIdle, containerRef);

  return (
    <KioskFlowShell title="Complete your purchase" onBack={onBack}>
      <div className="kiosk-widget-wrap" ref={containerRef}>
        <givebutter-widget id={product.widgetId} />
      </div>
    </KioskFlowShell>
  );
}

// The kiosk's sign-up/purchase flow — a small, purely client-side page stack layered
// over KioskPage's home screen (search + check-in), which KioskPage swaps in whenever
// `screen.kind !== "home"`. No backend involvement at all: every "purchase" is just
// navigating to (or embedding) one of Givebutter's own hosted forms/widgets, which
// handle the actual payment and sync back into Members via whatever process already
// populates that table (see SPEC.md's "Merging duplicate students" for the one place
// that sync's quirks already show up).
export function KioskPurchaseFlow({
  screen,
  onNavigate,
  onExit,
}: {
  screen: KioskFlowScreen;
  onNavigate: (screen: KioskFlowScreen) => void;
  onExit: () => void;
}) {
  switch (screen.kind) {
    case "signup":
      return <KioskSignupScreen onBack={onExit} />;

    case "buyAPass":
      return (
        <KioskBuyAPassScreen
          onBack={onExit}
          onSelectDropIn={() => onNavigate({ kind: "dropInCount" })}
          onSelectMembership={() => onNavigate({ kind: "membershipCount" })}
        />
      );

    case "dropInCount":
      return (
        <KioskClassCountScreen
          title="How many classes would you like to take today?"
          onBack={() => onNavigate({ kind: "buyAPass" })}
          onSelect={(count) => onNavigate({ kind: "qr", product: DROPIN_PRODUCTS[count] })}
        />
      );

    case "membershipCount":
      return (
        <KioskClassCountScreen
          title="How many classes would you like to take per week?"
          onBack={() => onNavigate({ kind: "buyAPass" })}
          onSelect={(count) => onNavigate({ kind: "qr", product: MEMBERSHIP_PRODUCTS[count] })}
        />
      );

    case "qr":
      return (
        <KioskQrScreen
          product={screen.product}
          onBack={() =>
            onNavigate(screen.product.key.startsWith("dropin") ? { kind: "dropInCount" } : { kind: "membershipCount" })
          }
          onPayOnTablet={() => onNavigate({ kind: "widget", product: screen.product })}
          onIdle={onExit}
        />
      );

    case "widget":
      return <KioskWidgetScreen product={screen.product} onBack={() => onNavigate({ kind: "qr", product: screen.product })} onIdle={onExit} />;
  }
}
