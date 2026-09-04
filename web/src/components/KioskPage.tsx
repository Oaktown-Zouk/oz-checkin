import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import banner from "../../assets/banner.png";
import {
  api,
  UnauthorizedError,
  ForbiddenError,
  type CheckInSelection,
  type KioskRosterEntry,
  type ProgramSchedule,
  type StudentStatus,
} from "../api.js";
import { usePermissions } from "../permissions.js";
import type { KioskScreen } from "../kioskProducts.js";
import { EffectiveDateControl } from "./EffectiveDateControl.js";
import { KioskCheckInDialog } from "./KioskCheckInDialog.js";
import { KioskPurchaseFlow } from "./KioskPurchaseFlow.js";
import { studioLocalToUtc } from "../programSchedule.js";
import { ErrorBanner, Portal } from "shared";

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

// The self-serve check-in station (`/kiosk`) — a student types their name, taps
// Lead/Follow, and walks in with no staff involvement — plus, layered on the same
// home screen, a sign-up/purchase flow for new students (KioskPurchaseFlow.tsx). See
// SPEC.md's "Kiosk mode" section for the full design.
//
// The full student roster (name/id/credits/membership-status/remaining) is fetched
// once and cached in `roster` state rather than round-tripping to the server per
// keystroke (see api.ts's kioskRoster) — the name search runs against this local
// snapshot. Once a specific id is resolved, though, the actual status always comes
// fresh from the server (see resolveId below) — the cache is only ever used to find
// *who*, never to decide *whether*.
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
  // EffectiveDateControl. "" means live, same convention as the front desk's. Seeded
  // from the URL on mount (only when canBackdate — a non-admin session's URL is never
  // trusted here, same as the server independently re-checking Backdate Kiosk on every
  // request) so a shared/bookmarked test link actually lands on the simulated time
  // instead of always silently opening live. Kept namespaced to this component (not
  // App.tsx's own effectiveAt for the front desk) since the two need independent
  // permission gates on the same query param name across different routes.
  const [effectiveAt, setEffectiveAtState] = useState(() =>
    canBackdate ? (new URLSearchParams(window.location.search).get("effectiveAt") ?? "") : ""
  );
  const setEffectiveAt = useCallback((value: string) => {
    setEffectiveAtState(value);
    const params = new URLSearchParams(window.location.search);
    if (value) params.set("effectiveAt", value);
    else params.delete("effectiveAt");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);
  const effectiveDate = effectiveAt ? effectiveAt.slice(0, 10) : undefined;

  const [roster, setRoster] = useState<KioskRosterEntry[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [query, setQuery] = useState("");
  // The sign-up/purchase flow (KioskPurchaseFlow.tsx) — a separate screen stack from
  // `dialog` above, since it's a fully client-side, non-authenticated-student flow
  // (browsing/paying for a pass) rather than anything scoped to a resolved roster
  // entry. "home" means the ordinary search+check-in screen below is showing.
  const [screen, setScreen] = useState<KioskScreen>({ kind: "home" });
  // Surfaces a failed check-in write after the fact — by the time a background write
  // could fail, the dialog that started it has already shown the welcome message and
  // closed (see KioskCheckInDialog's onSubmit), so this is the only place left to show
  // it. Stays up until dismissed, not auto-hidden.
  const [checkinError, setCheckinError] = useState<string | null>(null);

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

  // Fire-and-forget, called from KioskCheckInDialog's Done button — the dialog has
  // already shown the welcome message and started closing by the time this runs, so
  // there's nothing to update optimistically here (unlike the front desk's roster
  // grid, nothing about this student stays visible on screen). Just starts the write,
  // then queues the roster refresh (the "read") once it settles, and surfaces a
  // failure via the banner since the dialog itself is gone by then.
  function handleCheckIn(studentId: string, selections: CheckInSelection[]) {
    const effectiveIso = effectiveAt ? studioLocalToUtc(effectiveAt).toISOString() : undefined;
    api
      .checkIn(studentId, selections, effectiveIso, "Kiosk")
      .catch((err) => {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
          onUnauthorized();
          return;
        }
        setCheckinError(err instanceof Error ? err.message : "Check-in failed");
      })
      .then(() => refreshRoster());
  }

  return (
    <div className="kiosk-page">
      {checkinError && <ErrorBanner message={checkinError} onDismiss={() => setCheckinError(null)} />}
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

      {screen.kind === "home" ? (
        <div className="kiosk-main">
          <div className="kiosk-search-wrap">
            <input
              className="search-bar"
              type="search"
              placeholder="Type your name…"
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

          <div className="kiosk-action-buttons">
            <button type="button" className="btn btn-secondary kiosk-action-btn" onClick={() => setScreen({ kind: "signupCount" })}>
              First time? Sign up for a free class!
            </button>
            <button type="button" className="btn btn-secondary kiosk-action-btn" onClick={() => setScreen({ kind: "buyAPass" })}>
              Buy a pass or membership
            </button>
          </div>
        </div>
      ) : (
        <KioskPurchaseFlow screen={screen} onNavigate={setScreen} onExit={() => setScreen({ kind: "home" })} />
      )}

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
        <KioskCheckInDialog
          student={dialog.status}
          programs={programs}
          effectiveAt={effectiveAt}
          onSubmit={(selections) => handleCheckIn(dialog.status.id, selections)}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
