import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  UnauthorizedError,
  ForbiddenError,
  type CheckInSelection,
  type Permission,
  type ProgramSchedule,
  type StudentStatus,
} from "./api.js";
import { PermissionsProvider } from "./permissions.js";
import { Login } from "./components/Login.js";
import { Forbidden } from "./components/Forbidden.js";
import { SearchBar } from "./components/SearchBar.js";
import { StudentList } from "./components/StudentList.js";
import { EffectiveDateControl } from "./components/EffectiveDateControl.js";
import { StudentPage } from "./components/StudentPage.js";
import { KioskPage } from "./components/KioskPage.js";
import { NavMenu } from "./components/NavMenu.js";

function formatEffectiveBanner(datetimeLocal: string): string {
  return new Date(datetimeLocal).toLocaleString([], { dateStyle: "full", timeStyle: "short" });
}

type Route = { type: "list" } | { type: "student"; id: string } | { type: "kiosk" };

function parseRoute(pathname: string): Route {
  if (pathname === "/kiosk") return { type: "kiosk" };
  // Airtable record ids (e.g. "recAbCd1234EfGhIj"), not the old numeric SQLite ids.
  const match = pathname.match(/^\/students\/([^/]+)$/);
  if (match) return { type: "student", id: match[1] };
  return { type: "list" };
}

function parseEffectiveAt(search: string): string {
  return new URLSearchParams(search).get("effectiveAt") ?? "";
}

// Builds the URL for a route + the current backdate, so every navigation (route change
// or effective-date change) keeps both in sync — a forced refresh while backdating lands
// back on the same past date instead of silently snapping to live.
function buildUrl(route: Route, effectiveAt: string): string {
  const pathname = route.type === "student" ? `/students/${route.id}` : "/";
  const params = new URLSearchParams();
  if (effectiveAt) params.set("effectiveAt", effectiveAt);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set());
  // A session with Create Checkins but not View Student Data (i.e. the Kiosk role) —
  // restricted to /kiosk entirely, never the roster. Distinct from `authenticated`,
  // which still means "has View Student Data" exactly as before.
  const [kioskOnly, setKioskOnly] = useState(false);
  // Set only for a valid session with neither of the above — distinct from "not
  // logged in" so they see who they're signed in as instead of just bouncing back to
  // the sign-in screen.
  const [forbiddenUser, setForbiddenUser] = useState<{ email: string; role: string } | null>(null);
  const [authError] = useState(() => new URLSearchParams(window.location.search).get("authError"));

  const handleLogout = useCallback(() => {
    api.logout().finally(() => {
      window.location.href = "/";
    });
  }, []);

  // Hand-rolled instead of pulling in a router: the app only ever has two "pages," and
  // this needs to (a) parse the initial URL on load so a direct link or a reload lands
  // on the right view, and (b) update the URL on navigation. Both are plain History API.
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  // "" means live (now); otherwise a datetime-local string ("2026-08-05T14:30") the
  // front desk picked to view and correct a past day. Kept in the URL (?effectiveAt=...)
  // so a forced refresh while backdating lands back on the same past date instead of
  // silently snapping to live.
  const [effectiveAt, setEffectiveAt] = useState(() => parseEffectiveAt(window.location.search));
  const effectiveDate = effectiveAt ? effectiveAt.slice(0, 10) : undefined;

  useEffect(() => {
    function onPopState() {
      setRoute(parseRoute(window.location.pathname));
      setEffectiveAt(parseEffectiveAt(window.location.search));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToStudent = useCallback(
    (id: string) => {
      window.history.pushState(null, "", buildUrl({ type: "student", id }, effectiveAt));
      setRoute({ type: "student", id });
    },
    [effectiveAt]
  );

  const navigateToList = useCallback(() => {
    window.history.pushState(null, "", buildUrl({ type: "list" }, effectiveAt));
    setRoute({ type: "list" });
  }, [effectiveAt]);

  // From the signed-out Google login screen — lets staff reach the kiosk password
  // form without needing to know/type the /kiosk URL themselves.
  const navigateToKiosk = useCallback(() => {
    window.history.pushState(null, "", "/kiosk");
    setRoute({ type: "kiosk" });
  }, []);

  const handleEffectiveAtChange = useCallback(
    (value: string) => {
      setEffectiveAt(value);
      window.history.replaceState(null, "", buildUrl(route, value));
    },
    [route]
  );

  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [programs, setPrograms] = useState<ProgramSchedule[]>([]);

  useEffect(() => {
    api
      .session()
      .then((s) => {
        if (s.authenticated && s.permissions?.includes("View Student Data")) {
          setAuthenticated(true);
          setUserEmail(s.email ?? null);
          setPermissions(new Set(s.permissions));
        } else if (s.authenticated && s.permissions?.includes("Create Checkins")) {
          setKioskOnly(true);
          setPermissions(new Set(s.permissions));
        } else if (s.authenticated) {
          setForbiddenUser({ email: s.email ?? "", role: s.role ?? "" });
        }
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
  }, []);

  // Fetched once per session, not per check-in dialog open — schedules don't change
  // mid-session, and re-fetching on every "Check In" click was slow. Filtered by
  // whichever date is relevant (live or backdated) client-side, see programSchedule.ts.
  useEffect(() => {
    if (!authenticated && !kioskOnly) return;
    api.programs().then(setPrograms).catch(() => setPrograms([]));
  }, [authenticated, kioskOnly]);

  // Cosmetic: keeps the URL bar honest for kiosk-only sessions that land here via a
  // route other than /kiosk (e.g. a fresh login, which parses whatever path Google's
  // redirect happened to land on).
  useEffect(() => {
    if (kioskOnly && window.location.pathname !== "/kiosk") {
      window.history.replaceState(null, "", "/kiosk");
    }
  }, [kioskOnly]);

  const handleKioskUnauthorized = useCallback(() => {
    setKioskOnly(false);
    setAuthenticated(false);
  }, []);

  // Fetches the full roster for the viewed date — not scoped by `query`. The search box
  // filters this in memory (see visibleStudents below) instead of round-tripping to the
  // server on every keystroke, which matters once the server isn't on the same machine.
  const refreshStudents = useCallback(async (date?: string) => {
    setLoading(true);
    try {
      const results = await api.students(date);
      setStudents(results);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const visibleStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  useEffect(() => {
    if (!authenticated) return;
    // effectiveDate can change rapidly while adjusting the backdate picker — debounced
    // the same way the old per-keystroke search fetch was, even though search itself no
    // longer triggers a fetch at all (see visibleStudents above).
    const handle = setTimeout(() => refreshStudents(effectiveDate), 250);
    return () => clearTimeout(handle);
  }, [authenticated, effectiveDate, refreshStudents]);

  async function handleCheckIn(studentId: string, selections: CheckInSelection[]) {
    try {
      const effectiveIso = effectiveAt ? new Date(effectiveAt).toISOString() : undefined;
      await api.checkIn(studentId, selections, effectiveIso);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Check-in failed");
    }
  }

  async function handleUndo(checkinId: string) {
    try {
      await api.undoCheckIn(checkinId);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Undo failed");
    }
  }

  async function handleUpdateLeadLevel(studentId: string, level: number | null) {
    try {
      await api.updateLeadLevel(studentId, level);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setAuthenticated(false);
      throw err;
    }
  }

  async function handleUpdateFollowLevel(studentId: string, level: number | null) {
    try {
      await api.updateFollowLevel(studentId, level);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setAuthenticated(false);
      throw err;
    }
  }

  async function handleTransferMembership(studentId: string, planId: string, targetEmail: string) {
    try {
      await api.transferMembership(studentId, planId, targetEmail);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setAuthenticated(false);
      throw err;
    }
  }

  if (!authChecked) return null;

  if (forbiddenUser) {
    return <Forbidden email={forbiddenUser.email} role={forbiddenUser.role} onLogout={handleLogout} />;
  }

  // Kiosk-only sessions always land here, regardless of route — see the URL-fixing
  // effect above. Staff/Volunteer accounts (who also hold Create Checkins) may visit
  // /kiosk directly too; `authenticated` here guards against an unauthenticated
  // visitor hitting /kiosk before login, since `route.type` alone doesn't imply auth.
  if (kioskOnly || (route.type === "kiosk" && authenticated)) {
    return (
      <PermissionsProvider value={permissions}>
        <NavMenu onNavigateFrontDesk={navigateToList} onNavigateKiosk={navigateToKiosk} />
        <KioskPage programs={programs} onUnauthorized={handleKioskUnauthorized} onLogout={handleLogout} />
      </PermissionsProvider>
    );
  }

  // Login offers both Google OAuth and a plain identifier/password form (for kiosk
  // tablets — see routes/auth.ts's /auth/kiosk-login) on the same screen, so every
  // unauthenticated route — /kiosk included — lands here. Whichever method succeeds
  // sends the browser to "/" and lets the session-derived checks above route it from
  // there (e.g. a Kiosk-role account ends up back on /kiosk regardless of where login
  // happened).
  if (!authenticated) {
    return <Login authError={authError} />;
  }

  if (route.type === "student") {
    return (
      <PermissionsProvider value={permissions}>
        <NavMenu onNavigateFrontDesk={navigateToList} onNavigateKiosk={navigateToKiosk} />
        <StudentPage studentId={route.id} onBack={navigateToList} onUnauthorized={() => setAuthenticated(false)} />
      </PermissionsProvider>
    );
  }

  return (
    <PermissionsProvider value={permissions}>
      <NavMenu onNavigateFrontDesk={navigateToList} onNavigateKiosk={navigateToKiosk} />
      <div className="app">
        <header className="app-header">
          <h1>OZ Check-In</h1>
          <div className="header-controls">
            {/* No live cross-device push (see SPEC.md) — front desk refreshes manually if
                another device's action needs to show up here. */}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => refreshStudents(effectiveDate)}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <EffectiveDateControl value={effectiveAt} onChange={handleEffectiveAtChange} />
            {userEmail && <span className="signed-in-as">{userEmail}</span>}
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>

        {effectiveAt && (
          <div className="effective-date-banner">
            <span>
              Viewing and Checking In for <strong>{formatEffectiveBanner(effectiveAt)}</strong>
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => handleEffectiveAtChange("")}>
              Return to live
            </button>
          </div>
        )}

        <SearchBar value={query} onChange={setQuery} />

        <StudentList
          students={visibleStudents}
          loading={loading}
          effectiveDate={effectiveDate}
          programs={programs}
          onCheckIn={handleCheckIn}
          onUndo={handleUndo}
          onOpenStudent={navigateToStudent}
          onUpdateLeadLevel={handleUpdateLeadLevel}
          onUpdateFollowLevel={handleUpdateFollowLevel}
          onTransferMembership={handleTransferMembership}
        />
      </div>
    </PermissionsProvider>
  );
}
