import type { TimelineEvent, NoteDetails } from "../types.js";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// The newest-first event feed at the bottom of a student's page — see types.ts's
// TimelineEvent for the event types (membership started/status, payments, credits,
// check-ins, level-ups, notes). A "note" row is clickable — it opens onOpenNote with
// the full note text, since the inline label only ever shows the summary.
export function Timeline({ events, onOpenNote }: { events: TimelineEvent[]; onOpenNote: (note: NoteDetails) => void }) {
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
