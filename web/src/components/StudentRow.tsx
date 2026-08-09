import { useState } from "react";
import type { StudentStatus } from "../api.js";
import { RowMenu } from "./RowMenu.js";
import { MergeDialog } from "./MergeDialog.js";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function StudentRow({
  student,
  onCheckIn,
  onUndo,
  onMerge,
}: {
  student: StudentStatus;
  onCheckIn: (studentId: number) => Promise<void>;
  onUndo: (checkinId: number) => Promise<void>;
  onMerge: (studentId: number, otherEmail: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  const hasMembership = Boolean(student.membership);
  const hasCredits = Boolean(student.credits);
  const hasAnyPayment = hasMembership || hasCredits;
  const creditsAvailable = student.credits?.available ?? 0;

  async function handleCheckIn() {
    const warnings: string[] = [];
    if (!student.waiver.signed) warnings.push("no waiver on file");
    if (!student.checkedInToday && !hasAnyPayment) warnings.push("no payment on file");
    if (warnings.length > 0) {
      const ok = window.confirm(`${student.name}: ${warnings.join(" and ")}. Check in anyway?`);
      if (!ok) return;
    }
    setBusy(true);
    try {
      await onCheckIn(student.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo(checkinId: number) {
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
        <div className="student-name">{student.name}</div>
        <div className="student-email">{student.email}</div>
        {student.alternateEmails.length > 0 && (
          <div className="student-alt-emails">also {student.alternateEmails.join(", ")}</div>
        )}
      </div>

      <div className="badges">
        <span className={`badge ${student.waiver.signed ? "badge-green" : "badge-red"}`}>
          {student.waiver.signed ? "Waiver signed" : "No waiver"}
        </span>

        {student.membership && (
          <span className={`badge ${student.membership.active ? "badge-green" : "badge-gray"}`}>
            {student.membership.active ? "Member" : `Member (${student.membership.status})`}
          </span>
        )}

        {student.credits && (
          <span className={`badge ${creditsAvailable > 0 ? "badge-green" : "badge-amber"}`}>
            {creditsAvailable > 0
              ? `${creditsAvailable} credit${creditsAvailable === 1 ? "" : "s"} available`
              : "No credits remaining"}
          </span>
        )}

        {!hasAnyPayment && <span className="badge badge-red">No payment on file</span>}
      </div>

      <div className="checkin-status">
        {student.checkinsToday.map((c) => (
          <div key={c.id} className="checkin-time-row">
            <span>Checked in {formatTime(c.checkedInAt)}</span>
            <button className="link-button" disabled={busy} onClick={() => handleUndo(c.id)}>
              Undo
            </button>
          </div>
        ))}
      </div>

      <div className="actions">
        {!student.checkedInToday && (
          <button className="btn btn-primary" disabled={busy} onClick={handleCheckIn}>
            Check In
          </button>
        )}
        {student.checkedInToday && creditsAvailable > 0 && (
          <button className="btn btn-secondary" disabled={busy} onClick={handleCheckIn}>
            Use another pass ({creditsAvailable} left)
          </button>
        )}
        <RowMenu items={[{ label: "Merge info", onClick: () => setMergeOpen(true) }]} />
      </div>

      {mergeOpen && (
        <MergeDialog
          studentName={student.name}
          onSubmit={(otherEmail) => onMerge(student.id, otherEmail)}
          onClose={() => setMergeOpen(false)}
        />
      )}
    </div>
  );
}
