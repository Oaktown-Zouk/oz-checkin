import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { StudentRow } from "./StudentRow.js";

export function StudentList({
  students,
  loading,
  effectiveDate,
  programs,
  onCheckIn,
  onUndo,
  onOpenStudent,
  onUpdateLeadLevel,
  onUpdateFollowLevel,
  onTransferMembership,
}: {
  students: StudentStatus[];
  loading: boolean;
  effectiveDate?: string;
  programs: ProgramSchedule[];
  onCheckIn: (studentId: string, selections: CheckInSelection[]) => Promise<void>;
  onUndo: (checkinId: string) => Promise<void>;
  onOpenStudent: (studentId: string) => void;
  onUpdateLeadLevel: (studentId: string, level: number | null) => Promise<void>;
  onUpdateFollowLevel: (studentId: string, level: number | null) => Promise<void>;
  onTransferMembership: (studentId: string, planId: string, targetEmail: string) => Promise<void>;
}) {
  if (loading && students.length === 0) {
    return <p className="empty-state">Loading…</p>;
  }
  if (students.length === 0) {
    return <p className="empty-state">No students match.</p>;
  }

  return (
    <div className="student-list">
      {students.map((s) => (
        <StudentRow
          key={s.id}
          student={s}
          effectiveDate={effectiveDate}
          programs={programs}
          onCheckIn={onCheckIn}
          onUndo={onUndo}
          onOpenStudent={onOpenStudent}
          onUpdateLeadLevel={onUpdateLeadLevel}
          onUpdateFollowLevel={onUpdateFollowLevel}
          onTransferMembership={onTransferMembership}
        />
      ))}
    </div>
  );
}
