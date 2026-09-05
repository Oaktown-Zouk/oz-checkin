import { useState } from "react";
import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { usePermissions } from "../permissions.js";
import { RowMenu } from "./RowMenu.js";
import { TransferDialog } from "./TransferDialog.js";
import { PreferredNameDialog } from "./PreferredNameDialog.js";
import { MergeDialog } from "./MergeDialog.js";
import { StudentBadges } from "./StudentBadges.js";
import { CheckInDialog } from "./CheckInDialog.js";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function StudentRow({
  student,
  allStudents,
  effectiveDate,
  programs,
  onCheckIn,
  onUndo,
  onOpenStudent,
  onUpdateLeadLevel,
  onUpdateFollowLevel,
  onUpdatePreferredName,
  onTransferMembership,
  onMerge,
}: {
  student: StudentStatus;
  // The full (unfiltered) roster — passed through untouched to MergeDialog, which
  // needs to search across every student, not just whatever the header search box
  // currently has typed into it. See App.tsx.
  allStudents: StudentStatus[];
  effectiveDate?: string;
  programs: ProgramSchedule[];
  onCheckIn: (studentId: string, selections: CheckInSelection[]) => void;
  onUndo: (checkinId: string) => Promise<void>;
  onOpenStudent: (studentId: string) => void;
  onUpdateLeadLevel: (studentId: string, level: number | null) => Promise<void>;
  onUpdateFollowLevel: (studentId: string, level: number | null) => Promise<void>;
  onUpdatePreferredName: (studentId: string, preferredName: string) => Promise<void>;
  onTransferMembership: (studentId: string, planId: string, targetEmail: string) => Promise<void>;
  onMerge: (survivorId: string, duplicateId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [preferredNameOpen, setPreferredNameOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const { has } = usePermissions();
  const canCheckIn = has("Create Checkins");
  const canUndo = has("Undo Checkins");
  const canEditStudentData = has("Write Student Data");
  const canTransfer = has("Write Memberships");
  const menuItems = [
    ...(canEditStudentData ? [{ label: "Set preferred name…", onClick: () => setPreferredNameOpen(true) }] : []),
    ...(canTransfer
      ? [
          { label: "Transfer membership", onClick: () => setTransferOpen(true) },
          { label: "Merge duplicate…", onClick: () => setMergeOpen(true) },
        ]
      : []),
  ];

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
            {canUndo && (
              <button className="link-button" disabled={busy} onClick={() => handleUndo(c.id)}>
                Undo
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="actions">
        {canCheckIn && (
          <button className="btn btn-primary" disabled={busy} onClick={() => setCheckInOpen(true)}>
            {student.checkedInToday ? "Check in to another class" : "Check In"}
          </button>
        )}
        {menuItems.length > 0 && <RowMenu items={menuItems} />}
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

      {preferredNameOpen && (
        <PreferredNameDialog
          student={student}
          onSubmit={(preferredName) => onUpdatePreferredName(student.id, preferredName)}
          onClose={() => setPreferredNameOpen(false)}
        />
      )}

      {transferOpen && (
        <TransferDialog
          student={student}
          onSubmit={(planId, targetEmail) => onTransferMembership(student.id, planId, targetEmail)}
          onClose={() => setTransferOpen(false)}
        />
      )}

      {mergeOpen && (
        <MergeDialog
          student={student}
          allStudents={allStudents}
          onSubmit={onMerge}
          onClose={() => setMergeOpen(false)}
        />
      )}
    </div>
  );
}
