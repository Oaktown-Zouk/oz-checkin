import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { StudentStatus } from "shared";
import { NavMenu, type StudentView } from "./NavMenu.js";

const QR_PIXELS = 320;

// The QR payload is the bare Givebutter Contact ID — the exact same value the
// kiosk's camera scanner expects (see web/src/useQrScanner.ts and
// server/src/scripts/generateQrCode.ts, which generates the printed version of this
// same code). No URL wrapper, no JSON envelope, and no backend change was needed
// here — GET /api/me/timeline already returns status.contactId.
export function StudentQrPage({
  status,
  view,
  onNavigate,
  onLogout,
}: {
  status: StudentStatus;
  view: StudentView;
  onNavigate: (view: StudentView) => void;
  onLogout: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!status.contactId) return;
    let cancelled = false;
    QRCode.toDataURL(status.contactId, { errorCorrectionLevel: "H", margin: 2, width: QR_PIXELS }).then(
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
  }, [status.contactId]);

  return (
    <div className="qr-page">
      {/* Unlike StudentSelfPage's header, the name here is centered with the rest of
          the page's content — the menu floats independently in the corner instead of
          sharing a space-between row with it. */}
      <div className="qr-page-nav">
        <NavMenu current={view} onNavigate={onNavigate} onLogout={onLogout} />
      </div>
      <h1>{status.name}</h1>
      {!status.contactId ? (
        <p className="empty-state">No QR code on file yet — ask the front desk if this seems wrong.</p>
      ) : dataUrl ? (
        <img className="qr-code-image" src={dataUrl} alt="Your check-in QR code" width={QR_PIXELS} height={QR_PIXELS} />
      ) : (
        <p className="empty-state">Generating your QR code…</p>
      )}
      <p className="qr-code-hint">Show this at the front desk, or scan it yourself at the kiosk, to check in.</p>
    </div>
  );
}
