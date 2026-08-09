import { useCallback, useEffect, useState } from "react";
import { api, UnauthorizedError, type StudentStatus, type SyncStatus } from "./api.js";
import { Login } from "./components/Login.js";
import { SearchBar } from "./components/SearchBar.js";
import { StudentList } from "./components/StudentList.js";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setAuthenticated(s.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const refreshStudents = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const results = await api.students(q);
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

  useEffect(() => {
    if (!authenticated) return;
    refreshSyncStatus();
  }, [authenticated, refreshSyncStatus]);

  useEffect(() => {
    if (!authenticated) return;
    const handle = setTimeout(() => refreshStudents(query), 250);
    return () => clearTimeout(handle);
  }, [authenticated, query, refreshStudents]);

  async function handleCheckIn(studentId: number) {
    try {
      await api.checkIn(studentId);
      await refreshStudents(query);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Check-in failed");
    }
  }

  async function handleUndo(checkinId: number) {
    try {
      await api.undoCheckIn(checkinId);
      await refreshStudents(query);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      else alert(err instanceof Error ? err.message : "Undo failed");
    }
  }

  async function handleMerge(studentId: number, otherEmail: string) {
    try {
      await api.mergeStudent(studentId, otherEmail);
      await refreshStudents(query);
    } catch (err) {
      if (err instanceof UnauthorizedError) setAuthenticated(false);
      throw err;
    }
  }

  async function handleRefresh() {
    setSyncing(true);
    try {
      await api.triggerSync();
      await Promise.all([refreshSyncStatus(), refreshStudents(query)]);
    } finally {
      setSyncing(false);
    }
  }

  if (!authChecked) return null;

  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>OZ Check-In</h1>
        <div className="sync-info">
          <span>
            Forms synced {timeAgo(syncStatus?.google_forms ?? null)} · Givebutter synced{" "}
            {timeAgo(syncStatus?.givebutter ?? null)}
          </span>
          <button className="btn btn-secondary" disabled={syncing} onClick={handleRefresh}>
            {syncing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </header>

      <SearchBar value={query} onChange={setQuery} />

      <StudentList
        students={students}
        loading={loading}
        onCheckIn={handleCheckIn}
        onUndo={handleUndo}
        onMerge={handleMerge}
      />
    </div>
  );
}
