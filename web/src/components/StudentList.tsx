import type { CheckInSelection, ProgramSchedule, StudentStatus } from "../api.js";
import { StudentRow } from "./StudentRow.js";

export function StudentList({
  students,
  allStudents,
  loading,
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
  students: StudentStatus[];
  // The full (unfiltered) roster — see StudentRow.tsx's comment; passed straight
  // through to MergeDialog regardless of what's currently typed into the search box.
  allStudents: StudentStatus[];
  loading: boolean;
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
          allStudents={allStudents}
          effectiveDate={effectiveDate}
          programs={programs}
          onCheckIn={onCheckIn}
          onUndo={onUndo}
          onOpenStudent={onOpenStudent}
          onUpdateLeadLevel={onUpdateLeadLevel}
          onUpdateFollowLevel={onUpdateFollowLevel}
          onUpdatePreferredName={onUpdatePreferredName}
          onTransferMembership={onTransferMembership}
          onMerge={onMerge}
        />
      ))}
    </div>
  );
}
