import type { StudentStatus } from "../api.js";
import { StudentRow } from "./StudentRow.js";

export function StudentList({
  students,
  loading,
  isClassDay,
  onCheckIn,
  onUndo,
  onOpenStudent,
  onUpdateLeadLevel,
  onUpdateFollowLevel,
  onTransferItem,
}: {
  students: StudentStatus[];
  loading: boolean;
  isClassDay: boolean;
  onCheckIn: (studentId: number) => Promise<void>;
  onUndo: (checkinId: number) => Promise<void>;
  onOpenStudent: (studentId: number) => void;
  onUpdateLeadLevel: (studentId: number, level: number | null) => Promise<void>;
  onUpdateFollowLevel: (studentId: number, level: number | null) => Promise<void>;
  onTransferItem: (
    studentId: number,
    kind: "membership" | "payment",
    itemId: number,
    targetEmail: string
  ) => Promise<void>;
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
          isClassDay={isClassDay}
          onCheckIn={onCheckIn}
          onUndo={onUndo}
          onOpenStudent={onOpenStudent}
          onUpdateLeadLevel={onUpdateLeadLevel}
          onUpdateFollowLevel={onUpdateFollowLevel}
          onTransferItem={onTransferItem}
        />
      ))}
    </div>
  );
}
