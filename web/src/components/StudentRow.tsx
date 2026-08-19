import { useState } from "react";
import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { RowMenu } from "./RowMenu.js";
import { TransferDialog } from "./TransferDialog.js";
import { StudentBadges } from "./StudentBadges.js";
import { CheckInDialog } from "./CheckInDialog.js";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function StudentRow({
  student,
  effectiveDate,
  programs,
  onCheckIn,
  onUndo,
  onOpenStudent,
  onUpdateLeadLevel,
  onUpdateFollowLevel,
  onTransferMembership,
}: {
  student: StudentStatus;
  effectiveDate?: string;
  programs: ProgramSchedule[];
  onCheckIn: (studentId: string, selections: CheckInSelection[]) => Promise<void>;
  onUndo: (checkinId: string) => Promise<void>;
  onOpenStudent: (studentId: string) => void;
  onUpdateLeadLevel: (studentId: string, level: number | null) => Promise<void>;
  onUpdateFollowLevel: (studentId: string, level: number | null) => Promise<void>;
  onTransferMembership: (studentId: string, planId: string, targetEmail: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);

  async function handleUndo(checkinId: string) {
    setBusy(true);
    try {
      await onUndo(checkinId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`student-row${student.checkedInToday ? " checked-in" : ""}`}>
      <div className="student-info">
        <a
          href={`/students/${student.id}`}
          className="student-name"
          onClick={(e) => {
            e.preventDefault();
            onOpenStudent(student.id);
          }}
        >
          {student.name}
        </a>
        <div className="student-email">{student.email}</div>
      </div>

      <StudentBadges
        student={student}
        onUpdateLeadLevel={(level) => onUpdateLeadLevel(student.id, level)}
        onUpdateFollowLevel={(level) => onUpdateFollowLevel(student.id, level)}
      />

      <div className="checkin-status">
        {student.checkinsToday.map((c) => (
          <div key={c.id} className="checkin-time-row">
            <span>
              {formatTime(c.checkedInAt)}
              {c.programName && ` · ${c.programName}`}
              {c.role && ` (${c.role})`}
              {c.needsReview && (
                <span className="badge badge-red" title={c.reviewReason ?? undefined}>
                  Needs review
                </span>
              )}
            </span>
            <button className="link-button" disabled={busy} onClick={() => handleUndo(c.id)}>
              Undo
            </button>
          </div>
        ))}
      </div>

      <div className="actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => setCheckInOpen(true)}>
          {student.checkedInToday ? "Check in to another class" : "Check In"}
        </button>
        <RowMenu items={[{ label: "Transfer membership", onClick: () => setTransferOpen(true) }]} />
      </div>

      {checkInOpen && (
        <CheckInDialog
          student={student}
          effectiveDate={effectiveDate}
          programs={programs}
          onSubmit={(selections) => onCheckIn(student.id, selections)}
          onClose={() => setCheckInOpen(false)}
        />
      )}

      {transferOpen && (
        <TransferDialog
          student={student}
          onSubmit={(planId, targetEmail) => onTransferMembership(student.id, planId, targetEmail)}
          onClose={() => setTransferOpen(false)}
        />
      )}
    </div>
  );
}
