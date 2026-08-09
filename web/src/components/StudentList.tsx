import type { StudentStatus } from "../api.js";
import { StudentRow } from "./StudentRow.js";

export function StudentList({
  students,
  loading,
  onCheckIn,
  onUndo,
  onMerge,
}: {
  students: StudentStatus[];
  loading: boolean;
  onCheckIn: (studentId: number) => Promise<void>;
  onUndo: (checkinId: number) => Promise<void>;
  onMerge: (studentId: number, otherEmail: string) => Promise<void>;
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
        <StudentRow key={s.id} student={s} onCheckIn={onCheckIn} onUndo={onUndo} onMerge={onMerge} />
      ))}
    </div>
  );
}
