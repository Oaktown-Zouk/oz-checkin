import { useState } from "react";
import type { StudentStatus } from "../api.js";
import { RowMenu } from "./RowMenu.js";
import { MergeDialog } from "./MergeDialog.js";
import { TransferDialog } from "./TransferDialog.js";
import { StudentBadges } from "./StudentBadges.js";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function StudentRow({
  student,
  isClassDay,
  onCheckIn,
  onUndo,
  onMerge,
  onOpenStudent,
  onUpdateLeadLevel,
  onUpdateFollowLevel,
  onTransferItem,
}: {
  student: StudentStatus;
  isClassDay: boolean;
  onCheckIn: (studentId: number) => Promise<void>;
  onUndo: (checkinId: number) => Promise<void>;
  onMerge: (studentId: number, otherEmail: string) => Promise<void>;
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
  const [busy, setBusy] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const hasMembership = Boolean(student.membership);
  const hasCredits = Boolean(student.credits);
  const hasAnyPayment = hasMembership || hasCredits;
  const creditsAvailable = student.credits?.available ?? 0;

  async function handleCheckIn() {
    // Every new student is granted a real, redeemable free-drop-in credit at account
    // creation (server-side, see lib/upsertStudent.ts) — it auto-spends through the
    // normal credit flow just like a purchased pass, so there's nothing special to
    // confirm here beyond the same warnings any other check-in might raise.
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
        {student.alternateEmails.length > 0 && (
          <div className="student-alt-emails">also {student.alternateEmails.join(", ")}</div>
        )}
      </div>

      <StudentBadges
        student={student}
        onUpdateLeadLevel={(level) => onUpdateLeadLevel(student.id, level)}
        onUpdateFollowLevel={(level) => onUpdateFollowLevel(student.id, level)}
      />

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
          <button
            className="btn btn-primary"
            disabled={busy || !isClassDay}
            title={isClassDay ? undefined : "OZ only teaches class on Thursdays"}
            onClick={handleCheckIn}
          >
            Check In
          </button>
        )}
        {student.checkedInToday && creditsAvailable > 0 && (
          <button
            className="btn btn-secondary"
            disabled={busy || !isClassDay}
            title={isClassDay ? undefined : "OZ only teaches class on Thursdays"}
            onClick={handleCheckIn}
          >
            Use another pass ({creditsAvailable} left)
          </button>
        )}
        <RowMenu
          items={[
            { label: "Merge info", onClick: () => setMergeOpen(true) },
            { label: "Transfer membership/credit", onClick: () => setTransferOpen(true) },
          ]}
        />
      </div>

      {mergeOpen && (
        <MergeDialog
          studentName={student.name}
          onSubmit={(otherEmail) => onMerge(student.id, otherEmail)}
          onClose={() => setMergeOpen(false)}
        />
      )}

      {transferOpen && (
        <TransferDialog
          student={student}
          onSubmit={(kind, itemId, targetEmail) =>
            onTransferItem(student.id, kind, itemId, targetEmail)
          }
          onClose={() => setTransferOpen(false)}
        />
      )}
    </div>
  );
}
