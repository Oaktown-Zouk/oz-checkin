import { useCallback, useEffect, useMemo, useState } from "react";
import { api, UnauthorizedError, type StudentStatus } from "./api.js";
import { Login } from "./components/Login.js";
import { SearchBar } from "./components/SearchBar.js";
import { StudentList } from "./components/StudentList.js";
import { EffectiveDateControl } from "./components/EffectiveDateControl.js";
import { StudentPage } from "./components/StudentPage.js";

function formatEffectiveBanner(datetimeLocal: string): string {
  return new Date(datetimeLocal).toLocaleString([], { dateStyle: "full", timeStyle: "short" });
}

const CLASS_WEEKDAY = 4; // Thursday (0 = Sunday) — the only day OZ teaches class.

function isClassDay(effectiveAt: string): boolean {
  const viewedDate = effectiveAt ? new Date(effectiveAt) : new Date();
  return viewedDate.getDay() === CLASS_WEEKDAY;
}

type Route = { type: "list" } | { type: "student"; id: number };

function parseRoute(pathname: string): Route {
  const match = pathname.match(/^\/students\/(\d+)$/);
  if (match) return { type: "student", id: Number(match[1]) };
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
  // Class only runs Thursdays — the Check In button is disabled for any other viewed
  // date (live or backdated), so front desk can't accidentally record a visit on a day
  // there's no class to attend.
  const classDay = isClassDay(effectiveAt);

  useEffect(() => {
    function onPopState() {
      setRoute(parseRoute(window.location.pathname));
      setEffectiveAt(parseEffectiveAt(window.location.search));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToStudent = useCallback(
    (id: number) => {
      window.history.pushState(null, "", buildUrl({ type: "student", id }, effectiveAt));
      setRoute({ type: "student", id });
    },
    [effectiveAt]
  );

  const navigateToList = useCallback(() => {
    window.history.pushState(null, "", buildUrl({ type: "list" }, effectiveAt));
    setRoute({ type: "list" });
  }, [effectiveAt]);

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

  useEffect(() => {
    api
      .session()
      .then((s) => setAuthenticated(s.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
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
      if (err instanceof UnauthorizedError) setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const visibleStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  // Bumped on every backend-pushed "changed" event (see the SSE effect below). Both the
  // list view and StudentPage react to it independently via their own effects, so
  // whichever is actually on screen stays live without polling.
  const [changeSignal, setChangeSignal] = useState(0);

  useEffect(() => {
    if (!authenticated) return;
    // effectiveDate can change rapidly while adjusting the backdate picker — debounced
    // the same way the old per-keystroke search fetch was, even though search itself no
    // longer triggers a fetch at all (see visibleStudents above).
    const handle = setTimeout(() => refreshStudents(effectiveDate), 250);
    return () => clearTimeout(handle);
  }, [authenticated, effectiveDate, changeSignal, refreshStudents]);

  // One persistent Server-Sent Events connection instead of polling on a timer: the
  // backend pushes a "changed" event after any real write (check-in, undo, merge, sync
  // landing) so every open tab — useful once there's more than one front-desk device —
  // picks it up right away. The very first event on every connection (including
  // reconnects) is the server's per-boot random id; EventSource auto-reconnects on its
  // own after a network blip or a backend restart, and comparing bootId is how we tell
  // those apart — same server on reconnect means no reload, a different id means the
  // process actually restarted, so reload to pick up any new frontend build too.
  useEffect(() => {
    if (!authenticated) return;

    let knownBootId: string | null = null;
    const source = new EventSource("/api/events");

    source.addEventListener("boot", (e) => {
      const { bootId } = JSON.parse((e as MessageEvent).data);
      if (knownBootId === null) knownBootId = bootId;
      else if (bootId !== knownBootId) window.location.reload();
    });

    source.addEventListener("changed", () => {
      setChangeSignal((n) => n + 1);
    });

    return () => source.close();
  }, [authenticated]);

  async function handleCheckIn(studentId: number) {
    try {
      const effectiveIso = effectiveAt ? new Date(effectiveAt).toISOString() : undefined;
      await api.checkIn(studentId, undefined, effectiveIso);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Check-in failed");
    }
  }

  async function handleUndo(checkinId: number) {
    try {
      await api.undoCheckIn(checkinId);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Undo failed");
    }
  }

  async function handleUpdateLeadLevel(studentId: number, level: number | null) {
    try {
      await api.updateLeadLevel(studentId, level);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      throw err;
    }
  }

  async function handleUpdateFollowLevel(studentId: number, level: number | null) {
    try {
      await api.updateFollowLevel(studentId, level);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      throw err;
    }
  }

  async function handleTransferItem(
    studentId: number,
    kind: "membership" | "payment",
    itemId: number,
    targetEmail: string
  ) {
    try {
      await api.transferItem(studentId, kind, itemId, targetEmail);
      await refreshStudents(effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      throw err;
    }
  }

  if (!authChecked) return null;

  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  if (route.type === "student") {
    return (
      <StudentPage
        studentId={route.id}
        changeSignal={changeSignal}
        onBack={navigateToList}
        onUnauthorized={() => setAuthenticated(false)}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>OZ Check-In</h1>
        <div className="header-controls">
          <EffectiveDateControl value={effectiveAt} onChange={handleEffectiveAtChange} />
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
        isClassDay={classDay}
        onCheckIn={handleCheckIn}
        onUndo={handleUndo}
        onOpenStudent={navigateToStudent}
        onUpdateLeadLevel={handleUpdateLeadLevel}
        onUpdateFollowLevel={handleUpdateFollowLevel}
        onTransferItem={handleTransferItem}
      />
    </div>
  );
}
