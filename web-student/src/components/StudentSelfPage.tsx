import { useState } from "react";
import { LevelBadge, MembershipBadge, Timeline, NoteDetailModal, type StudentTimeline, type NoteDetails } from "shared";
import { NavMenu, type StudentView } from "./NavMenu.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}

// The entire read-only self-service view — no edit affordances anywhere on this page:
// no level-edit dialog, no Transfer button, no Add note button. This app never even
// imports those components (see web/src/components/StudentPage.tsx for the staff
// equivalent, which does), so there's nothing here that could be wired up to a write
// action even by mistake. No outer app wrapper here — App.tsx owns that (and the
// banner above it) — but the nav menu lives inline with the name here, not in App.tsx,
// since StudentQrPage.tsx needs the exact same placement next to its own heading.
export function StudentSelfPage({
  timeline,
  view,
  onNavigate,
  onLogout,
}: {
  timeline: StudentTimeline;
  view: StudentView;
  onNavigate: (view: StudentView) => void;
  onLogout: () => void;
}) {
  const [viewingNote, setViewingNote] = useState<NoteDetails | null>(null);
  const { status } = timeline;

  return (
    <>
      <div className="student-page-header">
        <div className="page-header-row">
          <h1>{status.name}</h1>
          <NavMenu current={view} onNavigate={onNavigate} onLogout={onLogout} />
        </div>
        <div className="student-email">{status.email}</div>
        <div className="badges">
          <span className="student-levels">
            <LevelBadge level={status.leadLevel} shape="square" />
            <LevelBadge level={status.followLevel} shape="circle" />
          </span>
          <MembershipBadge student={status} />
        </div>
      </div>

      <div className="student-stats">
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
        <div className="stat">
          <div className="stat-label">Lead Level</div>
          <div className="stat-value">
            <LevelBadge level={status.leadLevel} shape="square" />
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Follow Level</div>
          <div className="stat-value">
            <LevelBadge level={status.followLevel} shape="circle" />
          </div>
        </div>
      </div>

      <h2 className="timeline-heading">Timeline</h2>
      <Timeline events={timeline.events} onOpenNote={setViewingNote} />

      {viewingNote && <NoteDetailModal note={viewingNote} onClose={() => setViewingNote(null)} />}
    </>
  );
}
