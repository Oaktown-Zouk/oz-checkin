import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  DROPIN_SLIDING_SCALE_POLICY_NOTE,
  FIRST_DAY_SECOND_CLASS_NOTE,
  KIOSK_PRICING_CONTACT_CLAUSE,
  MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE,
  PRICING_CONTACT_EMAIL,
  WAIVER_NOTICE,
} from "shared";
import { useGivebutterWidgetScript } from "../useGivebutterWidgetScript.js";
import { useIdleTimer } from "../useIdleTimer.js";
import {
  DROPIN_PRODUCTS,
  KIOSK_SIGNUP_PAGE_URL,
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

// Used by KioskBuyAPassScreen's QR code (the flow's only one now — see
// KIOSK_SIGNUP_PAGE_URL) — null while generating and if `url` is falsy/generation
// fails, so the caller can render a loading state either way without distinguishing
// the two.
function useQrDataUrl(url: string | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { errorCorrectionLevel: "H", margin: 2, width: QR_PIXELS }).then(
      (result) => {
        if (!cancelled) setDataUrl(result);
      },
      () => {
        if (!cancelled) setDataUrl(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return dataUrl;
}

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

// Same waiver notice the public widget shows before its own free-class step (see
// shared/src/purchaseCopy.ts's WAIVER_NOTICE) — two inline links in the middle of
// one sentence, so it's rendered from structured data rather than one plain string.
function KioskWaiverScreen({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  useIdleTimer(FLOW_IDLE_MS, onBack);

  return (
    <KioskFlowShell title="Before your first class" onBack={onBack}>
      <p className="kiosk-flow-policy-note">
        {WAIVER_NOTICE.prefix}{" "}
        <a href={WAIVER_NOTICE.codeOfConduct.url} target="_blank" rel="noopener">
          {WAIVER_NOTICE.codeOfConduct.label}
        </a>{" "}
        {WAIVER_NOTICE.connector}{" "}
        <a href={WAIVER_NOTICE.liabilityWaiver.url} target="_blank" rel="noopener">
          {WAIVER_NOTICE.liabilityWaiver.label}
        </a>
      </p>
      <button type="button" className="btn btn-primary kiosk-flow-option" onClick={onContinue}>
        Continue
      </button>
    </KioskFlowShell>
  );
}

function KioskFreeClassScreen({ onBack, onIdle }: { onBack: () => void; onIdle: () => void }) {
  useGivebutterWidgetScript();
  const containerRef = useRef<HTMLDivElement>(null);
  useIdleTimer(WIDGET_IDLE_MS, onIdle, containerRef);

  return (
    <KioskFlowShell title="Sign up for a free class" onBack={onBack}>
      <div className="kiosk-widget-wrap" ref={containerRef}>
        <givebutter-widget id={SIGNUP_PRODUCT.widgetId} />
      </div>
    </KioskFlowShell>
  );
}

// A first-timer who wants a second class on their first day: the first is free, the
// second is one ordinary drop-in — see FIRST_DAY_SECOND_CLASS_NOTE, which this reuses
// as the title exactly like the public widget uses it as that step's own heading, and
// DROPIN_PRODUCTS[1], the same product/price a returning student's single drop-in
// uses. No sliding-scale policy note here, matching the public widget's own version
// of this step — this note already covers the pricing context that step needs.
function KioskSecondClassScreen({ onBack, onIdle }: { onBack: () => void; onIdle: () => void }) {
  useGivebutterWidgetScript();
  const containerRef = useRef<HTMLDivElement>(null);
  useIdleTimer(WIDGET_IDLE_MS, onIdle, containerRef);

  return (
    <KioskFlowShell title={FIRST_DAY_SECOND_CLASS_NOTE} onBack={onBack}>
      <div className="kiosk-widget-wrap" ref={containerRef}>
        <givebutter-widget id={DROPIN_PRODUCTS[1].widgetId} />
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
  const dataUrl = useQrDataUrl(KIOSK_SIGNUP_PAGE_URL);

  return (
    <KioskFlowShell title="Buy a pass" onBack={onBack}>
      <p className="kiosk-flow-subtitle">Scan to buy on your phone</p>
      {dataUrl ? (
        <img src={dataUrl} alt="QR code to buy a pass or membership on your phone" className="kiosk-qr-image" />
      ) : (
        <p className="dialog-description">Loading QR code…</p>
      )}
      <p className="kiosk-flow-subtitle">Or buy on this tablet</p>
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

// Same sliding-scale wording the public sign-up widget shows above its own embeds
// (see shared/src/purchaseCopy.ts) — this screen previously showed no pricing
// context at all before the embed. Signup has no policy note (it's free), matching
// the public widget's own free-first-class step.
function policyNoteFor(product: GivebutterProduct): string | null {
  if (product.key.startsWith("dropin")) return DROPIN_SLIDING_SCALE_POLICY_NOTE;
  if (product.key.startsWith("membership")) return MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE;
  return null;
}

function KioskWidgetScreen({ product, onBack, onIdle }: { product: GivebutterProduct; onBack: () => void; onIdle: () => void }) {
  useGivebutterWidgetScript();
  const containerRef = useRef<HTMLDivElement>(null);
  useIdleTimer(WIDGET_IDLE_MS, onIdle, containerRef);
  const policyNote = policyNoteFor(product);

  return (
    <KioskFlowShell title="Complete your purchase" onBack={onBack}>
      {policyNote && (
        <p className="kiosk-flow-policy-note">
          {policyNote} {KIOSK_PRICING_CONTACT_CLAUSE}{" "}
          <a href={`mailto:${PRICING_CONTACT_EMAIL}`}>{PRICING_CONTACT_EMAIL}</a>
        </p>
      )}
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
    case "signupCount":
      return (
        <KioskClassCountScreen
          title="How many classes would you like to take on your first day?"
          onBack={onExit}
          onSelect={(count) => onNavigate(count === 1 ? { kind: "signupWaiver" } : { kind: "signupSecondClass" })}
        />
      );

    case "signupWaiver":
      return (
        <KioskWaiverScreen
          onBack={() => onNavigate({ kind: "signupCount" })}
          onContinue={() => onNavigate({ kind: "signupFreeClass" })}
        />
      );

    case "signupFreeClass":
      return <KioskFreeClassScreen onBack={() => onNavigate({ kind: "signupWaiver" })} onIdle={onExit} />;

    case "signupSecondClass":
      return <KioskSecondClassScreen onBack={() => onNavigate({ kind: "signupCount" })} onIdle={onExit} />;

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
          onSelect={(count) => onNavigate({ kind: "widget", product: DROPIN_PRODUCTS[count] })}
        />
      );

    case "membershipCount":
      return (
        <KioskClassCountScreen
          title="How many classes would you like to take per week?"
          onBack={() => onNavigate({ kind: "buyAPass" })}
          onSelect={(count) => onNavigate({ kind: "widget", product: MEMBERSHIP_PRODUCTS[count] })}
        />
      );

    case "widget":
      return (
        <KioskWidgetScreen
          product={screen.product}
          onBack={() =>
            onNavigate(screen.product.key.startsWith("dropin") ? { kind: "dropInCount" } : { kind: "membershipCount" })
          }
          onIdle={onExit}
        />
      );
  }
}
