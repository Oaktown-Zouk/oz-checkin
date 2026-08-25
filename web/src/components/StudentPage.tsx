import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  UnauthorizedError,
  ForbiddenError,
  type StudentTimeline,
  type TimelineEvent,
  type NoteDetails,
} from "../api.js";
import { usePermissions } from "../permissions.js";
import { StudentBadges } from "./StudentBadges.js";
import { LevelEditDialog } from "./LevelEditDialog.js";
import { LevelBadge } from "./LevelBadge.js";
import { TransferDialog } from "./TransferDialog.js";
import { AddNoteDialog } from "./AddNoteDialog.js";
import { NoteDetailModal } from "./NoteDetailModal.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// One of the four boxes in the stats row — a plain `<div>` normally, or a clickable
// `<button>` when `onClick` is given (used for Lead/Follow, which open the level-edit
// dialog; "most recent check-in"/"total check-ins" have nothing to click through to).
function StatBox({ label, value, onClick }: { label: string; value: React.ReactNode; onClick?: () => void }) {
  const content = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </>
  );
  return onClick ? (
    <button type="button" className="stat stat-clickable" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat">{content}</div>
  );
}

// The newest-first event feed at the bottom of the page — see api.ts's TimelineEvent
// for the event types (membership started/status, payments, credits, check-ins,
// level-ups, notes). A "note" row is clickable — it opens onOpenNote with the full
// note text, since the inline label only ever shows the summary.
function Timeline({ events, onOpenNote }: { events: TimelineEvent[]; onOpenNote: (note: NoteDetails) => void }) {
  if (events.length === 0) return <p className="empty-state">No events yet.</p>;
  return (
    <div className="timeline">
      {events.map((e, i) => (
        <div className="timeline-event" key={`${e.type}-${e.at}-${i}`}>
          <span className={`timeline-dot timeline-dot-${e.type}`} />
          <div className="timeline-content">
            {e.type === "note" && e.note ? (
              <button type="button" className="timeline-note-link" onClick={() => onOpenNote(e.note!)}>
                <b>Note from {e.note.issuerName}:</b> {e.note.summary}
              </button>
            ) : (
              <div className="timeline-label">{e.label}</div>
            )}
            <div className="timeline-date">{formatDateTime(e.at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// The student detail page (`/students/:id`) — reached by clicking a name on the
// roster. Loads and displays:
//   - Header: name, email, the same badges as the roster row, and (with
//     Write Memberships) a "Transfer membership" button.
//   - Stats row: most recent check-in, total check-ins, and Lead/Follow level (the
//     level boxes are clickable and open the edit dialog when the session has
//     Write Student Data).
//   - A synthesized timeline of membership/payment/credit/check-in events.
// Actions available from here: edit Lead/Follow level, transfer a membership, and
// (via onBack) return to the roster — each gated by its own permission, see
// usePermissions() below.
export function StudentPage({
  studentId,
  onBack,
  onUnauthorized,
}: {
  studentId: string;
  onBack: () => void;
  onUnauthorized: () => void;
}) {
  const [timeline, setTimeline] = useState<StudentTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editingLevel, setEditingLevel] = useState<"lead" | "follow" | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [viewingNote, setViewingNote] = useState<NoteDetails | null>(null);
  const { has } = usePermissions();
  const canEditLevels = has("Write Student Data");
  const canTransfer = has("Write Memberships");
  const canAddNotes = has("Write Student Data");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.studentTimeline(studentId);
      setTimeline(result);
      setNotFound(false);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) onUnauthorized();
      else if (err instanceof ApiError) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [studentId, onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpdateLevel(kind: "lead" | "follow", level: number | null) {
    try {
      if (kind === "lead") await api.updateLeadLevel(studentId, level);
      else await api.updateFollowLevel(studentId, level);
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) onUnauthorized();
      throw err;
    }
  }

  async function handleTransferMembership(planId: string, targetEmail: string) {
    try {
      await api.transferMembership(studentId, planId, targetEmail);
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) onUnauthorized();
      throw err;
    }
  }

  async function handleAddNote(summary: string, strengths: string, opportunities: string) {
    try {
      await api.addNote(studentId, summary, strengths, opportunities);
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) onUnauthorized();
      throw err;
    }
  }

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
            <StudentBadges
              student={timeline.status}
              onUpdateLeadLevel={(level) => handleUpdateLevel("lead", level)}
              onUpdateFollowLevel={(level) => handleUpdateLevel("follow", level)}
            />
            {canTransfer && (
              <button
                type="button"
                className="btn btn-secondary transfer-link"
                onClick={() => setTransferOpen(true)}
              >
                Transfer membership
              </button>
            )}
          </div>

          <div className="student-stats">
            <StatBox
              label="Most recent check-in"
              value={timeline.mostRecentCheckInAt ? formatDate(timeline.mostRecentCheckInAt) : "Never"}
            />
            <StatBox label="Total check-ins" value={timeline.totalCheckIns} />
            <StatBox
              label="Lead Level"
              value={<LevelBadge level={timeline.status.leadLevel} shape="square" />}
              onClick={canEditLevels ? () => setEditingLevel("lead") : undefined}
            />
            <StatBox
              label="Follow Level"
              value={<LevelBadge level={timeline.status.followLevel} shape="circle" />}
              onClick={canEditLevels ? () => setEditingLevel("follow") : undefined}
            />
          </div>

          <div className="timeline-header">
            <h2 className="timeline-heading">Timeline</h2>
            {canAddNotes && (
              <button type="button" className="btn btn-secondary" onClick={() => setAddingNote(true)}>
                Add note
              </button>
            )}
          </div>
          <Timeline events={timeline.events} onOpenNote={setViewingNote} />
        </>
      )}

      {canEditLevels && editingLevel && timeline && (
        <LevelEditDialog
          title={editingLevel === "lead" ? "Edit Lead Level" : "Edit Follow Level"}
          currentLevel={editingLevel === "lead" ? timeline.status.leadLevel : timeline.status.followLevel}
          shape={editingLevel === "lead" ? "square" : "circle"}
          onSubmit={(level) => handleUpdateLevel(editingLevel, level)}
          onClose={() => setEditingLevel(null)}
        />
      )}

      {canTransfer && transferOpen && timeline && (
        <TransferDialog
          student={timeline.status}
          onSubmit={handleTransferMembership}
          onClose={() => setTransferOpen(false)}
        />
      )}

      {canAddNotes && addingNote && timeline && (
        <AddNoteDialog
          studentName={timeline.status.name}
          onSubmit={handleAddNote}
          onClose={() => setAddingNote(false)}
        />
      )}

      {viewingNote && <NoteDetailModal note={viewingNote} onClose={() => setViewingNote(null)} />}
    </div>
  );
}
