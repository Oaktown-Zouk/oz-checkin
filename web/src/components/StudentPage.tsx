import { useCallback, useEffect, useState } from "react";
import { api, ApiError, UnauthorizedError, type StudentTimeline } from "../api.js";
import { StudentBadges } from "./StudentBadges.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function StudentPage({
  studentId,
  changeSignal,
  onBack,
  onUnauthorized,
}: {
  studentId: number;
  changeSignal: number;
  onBack: () => void;
  onUnauthorized: () => void;
}) {
  const [timeline, setTimeline] = useState<StudentTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.studentTimeline(studentId);
      setTimeline(result);
      setNotFound(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized();
      else if (err instanceof ApiError) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [studentId, onUnauthorized]);

  useEffect(() => {
    load();
  }, [load, changeSignal]);

  return (
    <div className="app student-page">
      <button type="button" className="btn btn-secondary back-link" onClick={onBack}>
        ← Back
      </button>

      {loading && !timeline && <p className="empty-state">Loading…</p>}
      {notFound && <p className="empty-state">Student not found.</p>}

      {timeline && (
        <>
          <div className="student-page-header">
            <h1>{timeline.status.name}</h1>
            <div className="student-email">{timeline.status.email}</div>
            {timeline.status.alternateEmails.length > 0 && (
              <div className="student-alt-emails">
                also {timeline.status.alternateEmails.join(", ")}
              </div>
            )}
            <StudentBadges student={timeline.status} />
          </div>

          <div className="student-stats">
            <div className="stat">
              <div className="stat-label">First registered</div>
              <div className="stat-value">
                {timeline.firstRegisteredAt ? formatDate(timeline.firstRegisteredAt) : "—"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Most recent check-in</div>
              <div className="stat-value">
                {timeline.mostRecentCheckInAt ? formatDate(timeline.mostRecentCheckInAt) : "Never"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Total check-ins</div>
              <div className="stat-value">{timeline.totalCheckIns}</div>
            </div>
          </div>

          <h2 className="timeline-heading">Timeline</h2>
          {timeline.events.length === 0 ? (
            <p className="empty-state">No events yet.</p>
          ) : (
            <div className="timeline">
              {timeline.events.map((e, i) => (
                <div className="timeline-event" key={`${e.type}-${e.at}-${i}`}>
                  <span className={`timeline-dot timeline-dot-${e.type}`} />
                  <div className="timeline-content">
                    <div className="timeline-label">{e.label}</div>
                    <div className="timeline-date">{formatDateTime(e.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
