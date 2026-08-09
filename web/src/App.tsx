import { useCallback, useEffect, useRef, useState } from "react";
import { api, UnauthorizedError, type StudentStatus, type SyncStatus } from "./api.js";
import { Login } from "./components/Login.js";
import { SearchBar } from "./components/SearchBar.js";
import { StudentList } from "./components/StudentList.js";
import { EffectiveDateControl } from "./components/EffectiveDateControl.js";
import { StudentPage } from "./components/StudentPage.js";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatEffectiveBanner(datetimeLocal: string): string {
  return new Date(datetimeLocal).toLocaleString([], { dateStyle: "full", timeStyle: "short" });
}

type Route = { type: "list" } | { type: "student"; id: number };

function parseRoute(pathname: string): Route {
  const match = pathname.match(/^\/students\/(\d+)$/);
  if (match) return { type: "student", id: Number(match[1]) };
  return { type: "list" };
}

export function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // Hand-rolled instead of pulling in a router: the app only ever has two "pages," and
  // this needs to (a) parse the initial URL on load so a direct link or a reload lands
  // on the right view, and (b) update the URL on navigation. Both are plain History API.
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    function onPopState() {
      setRoute(parseRoute(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToStudent = useCallback((id: number) => {
    window.history.pushState(null, "", `/students/${id}`);
    setRoute({ type: "student", id });
  }, []);

  const navigateToList = useCallback(() => {
    window.history.pushState(null, "", "/");
    setRoute({ type: "list" });
  }, []);

  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  // "" means live (now); otherwise a datetime-local string ("2026-08-05T14:30") the
  // front desk picked to view and correct a past day. Not persisted — a page reload
  // always comes back up live, so nobody's stuck backdating without realizing it.
  const [effectiveAt, setEffectiveAt] = useState("");
  const effectiveDate = effectiveAt ? effectiveAt.slice(0, 10) : undefined;

  useEffect(() => {
    api
      .session()
      .then((s) => setAuthenticated(s.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const refreshStudents = useCallback(async (q: string, date?: string) => {
    setLoading(true);
    try {
      const results = await api.students(q, date);
      setStudents(results);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await api.syncStatus());
    } catch {
      // non-critical; header just won't show a timestamp
    }
  }, []);

  // Bumped on every backend-pushed "changed" event (see the SSE effect below). Both the
  // list view and StudentPage react to it independently via their own effects, so
  // whichever is actually on screen stays live without polling.
  const [changeSignal, setChangeSignal] = useState(0);

  useEffect(() => {
    if (!authenticated) return;
    refreshSyncStatus();
  }, [authenticated, changeSignal, refreshSyncStatus]);

  useEffect(() => {
    if (!authenticated) return;
    const handle = setTimeout(() => refreshStudents(query, effectiveDate), 250);
    return () => clearTimeout(handle);
  }, [authenticated, query, effectiveDate, changeSignal, refreshStudents]);

  // query/effectiveDate change on every keystroke/date-pick — read the latest values via
  // ref inside the SSE handlers below instead of putting them in that effect's deps,
  // which would otherwise tear down and reopen the connection constantly.
  const queryRef = useRef(query);
  const effectiveDateRef = useRef(effectiveDate);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);
  useEffect(() => {
    effectiveDateRef.current = effectiveDate;
  }, [effectiveDate]);

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
      await refreshStudents(query, effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Check-in failed");
    }
  }

  async function handleUndo(checkinId: number) {
    try {
      await api.undoCheckIn(checkinId);
      await refreshStudents(query, effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Undo failed");
    }
  }

  async function handleMerge(studentId: number, otherEmail: string) {
    try {
      await api.mergeStudent(studentId, otherEmail);
      await refreshStudents(query, effectiveDate);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      throw err;
    }
  }

  async function handleRefresh() {
    setSyncing(true);
    try {
      await api.triggerSync();
      await Promise.all([refreshSyncStatus(), refreshStudents(query, effectiveDate)]);
    } finally {
      setSyncing(false);
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
          <div className="sync-info">
            <span>
              Forms synced {timeAgo(syncStatus?.google_forms ?? null)} · Givebutter synced{" "}
              {timeAgo(syncStatus?.givebutter ?? null)}
            </span>
            <button className="btn btn-secondary" disabled={syncing} onClick={handleRefresh}>
              {syncing ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
          <EffectiveDateControl value={effectiveAt} onChange={setEffectiveAt} />
        </div>
      </header>

      {effectiveAt && (
        <div className="effective-date-banner">
          <span>
            Viewing and Checking In for <strong>{formatEffectiveBanner(effectiveAt)}</strong>
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => setEffectiveAt("")}>
            Return to live
          </button>
        </div>
      )}

      <SearchBar value={query} onChange={setQuery} />

      <StudentList
        students={students}
        loading={loading}
        onCheckIn={handleCheckIn}
        onUndo={handleUndo}
        onMerge={handleMerge}
        onOpenStudent={navigateToStudent}
      />
    </div>
  );
}
