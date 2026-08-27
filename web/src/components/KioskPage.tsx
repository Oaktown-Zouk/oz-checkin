import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import banner from "../../assets/banner.png";
import { api, UnauthorizedError, ForbiddenError, type KioskRosterEntry, type ProgramSchedule, type StudentStatus } from "../api.js";
import { usePermissions } from "../permissions.js";
import { useQrScanner } from "../useQrScanner.js";
import { EffectiveDateControl } from "./EffectiveDateControl.js";
import { KioskCheckInDialog } from "./KioskCheckInDialog.js";
import { Portal } from "shared";

const ERROR_DISPLAY_MS = 5000;
const MAX_SEARCH_RESULTS = 8;

// Something left to spend today: membership allowance or a purchased/comp credit.
function isEligible(status: StudentStatus): boolean {
  return status.remaining > 0 || status.availableCredits > 0;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Specific enough to actually help the student in front of the tablet (it's their own
// status, not someone else's) without a full account dump — see the roster-caching
// comment in services/kiosk.ts for why the roster cache itself still stays minimal.
function ineligibleReason(status: StudentStatus): string {
  const programNames = Array.from(
    new Set(status.checkinsToday.map((c) => c.programName).filter((n): n is string => !!n))
  );
  if (programNames.length > 0) {
    return `You've already checked in for ${formatList(programNames)}.\nNo credits remaining for today.`;
  }
  if (status.membershipStatus !== "Active") {
    return "It looks like you don't have an active membership or available credits — please see the front desk.";
  }
  return "Looks like you've used up your classes and credits for today — please see the front desk.";
}

// What's showing in the modal at any given moment: nothing, a brief loading spinner
// (shown the instant a scan/tap is recognized, before the network round-trip that
// resolves it completes), the real check-in dialog, or a decline message. Keeping
// this as one piece of state means there's always exactly one dialog on screen once a
// scan/tap is recognized — never a gap where nothing visible has happened yet.
type DialogState = { kind: "loading" } | { kind: "student"; status: StudentStatus } | { kind: "error"; message: string };

// The self-serve check-in station (`/kiosk`) — a student scans their QR code (their
// Givebutter contact id) or types their name, taps Lead/Follow, and walks in with no
// staff involvement. See SPEC.md's "Kiosk mode" section for the full design.
//
// The full student roster (name/id/credits/membership-status/remaining) is fetched
// once and cached in `roster` state rather than round-tripping to the server per
// keystroke (see api.ts's kioskRoster) — search and QR-scan matching (contactId ->
// id) both run against this local snapshot. Once a specific id is resolved, though,
// the actual status always comes fresh from the server (see resolveId below) — the
// cache is only ever used to find *who*, never to decide *whether*.
export function KioskPage({
  programs,
  onUnauthorized,
  onLogout,
}: {
  programs: ProgramSchedule[];
  onUnauthorized: () => void;
  onLogout: () => void;
}) {
  const { has } = usePermissions();
  const canBackdate = has("Backdate Kiosk");

  // Admin-only "simulate now" override, gated by Backdate Kiosk — see
  // EffectiveDateControl. "" means live, same convention as the front desk's.
  const [effectiveAt, setEffectiveAt] = useState("");
  const effectiveDate = effectiveAt ? effectiveAt.slice(0, 10) : undefined;

  const [roster, setRoster] = useState<KioskRosterEntry[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [query, setQuery] = useState("");

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showError(message: string) {
    setDialog({ kind: "error", message });
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setDialog(null), ERROR_DISPLAY_MS);
  }

  useEffect(() => () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, []);

  const refreshRoster = useCallback(() => {
    api
      .kioskRoster(effectiveDate)
      .then((res) => setRoster(res.students))
      .catch((err) => {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) onUnauthorized();
      });
  }, [effectiveDate, onUnauthorized]);

  useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);

  // Shows the loading dialog immediately — before the network round-trip — so a scan
  // or a search tap always gets instant visual feedback, never a silent pause.
  async function resolveId(id: string) {
    setDialog({ kind: "loading" });
    try {
      const status = await api.kioskStudent(id, effectiveDate);
      if (isEligible(status)) setDialog({ kind: "student", status });
      else showError(ineligibleReason(status));
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) onUnauthorized();
      else showError("We couldn't find your account — please see the front desk.");
    }
  }

  async function resolveScan(contactId: string) {
    const entry = roster.find((r) => r.contactId === contactId);
    if (!entry) {
      showError("We couldn't find your account — please see the front desk.");
      return;
    }
    await resolveId(entry.id);
  }

  const { videoRef, cameraError } = useQrScanner({
    enabled: dialog === null,
    onDetect: resolveScan,
  });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return roster.filter((r) => r.name.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
  }, [roster, query]);

  async function handleResultTap(entry: KioskRosterEntry) {
    setQuery("");
    await resolveId(entry.id);
  }

  function closeDialog() {
    setDialog(null);
    refreshRoster();
  }

  return (
    <div className="kiosk-page">
      <div className="kiosk-header-controls">
        {canBackdate && (
          <div className="kiosk-backdate-control">
            <EffectiveDateControl value={effectiveAt} onChange={setEffectiveAt} />
          </div>
        )}
        {/* The only sign-out affordance a kiosk-only session has — it doesn't hold the
            other permissions NavMenu requires to show its own logout-adjacent nav. */}
        <button type="button" className="btn btn-secondary kiosk-logout-btn" onClick={onLogout}>
          Log out
        </button>
      </div>

      <img src={banner} alt="Oaktown Zouk" className="kiosk-banner" />

      <div className="kiosk-main">
        <p className="kiosk-camera-label">Scan QR Code to Check In</p>
        <div className="kiosk-camera-wrap">
          {cameraError ? (
            <p className="kiosk-camera-error">{cameraError} Use the search bar below instead.</p>
          ) : (
            <video ref={videoRef} className="kiosk-video" muted playsInline />
          )}
        </div>

        <div className="kiosk-search-wrap">
          <input
            className="search-bar"
            type="search"
            placeholder="Or type your name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <div className="kiosk-search-results">
              {results.map((r) => (
                <button key={r.id} type="button" className="kiosk-search-result" onClick={() => handleResultTap(r)}>
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {dialog?.kind === "loading" && (
        <Portal>
          <div className="dialog-overlay">
            <div className="kiosk-dialog-card kiosk-dialog-message">
              <p>Loading…</p>
            </div>
          </div>
        </Portal>
      )}

      {dialog?.kind === "error" && (
        <Portal>
          <div className="dialog-overlay">
            <div className="kiosk-dialog-card kiosk-dialog-message">
              <p>{dialog.message}</p>
            </div>
          </div>
        </Portal>
      )}

      {dialog?.kind === "student" && (
        <KioskCheckInDialog student={dialog.status} programs={programs} effectiveAt={effectiveAt} onClose={closeDialog} />
      )}
    </div>
  );
}
