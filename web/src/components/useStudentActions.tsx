import { useState, type ReactNode } from "react";
import type { StudentStatus } from "../api.js";
import { usePermissions } from "../permissions.js";
import { TransferDialog } from "./TransferDialog.js";
import { SuspendDialog } from "./SuspendDialog.js";

// Transfer membership and Suspend/Unsuspend, each gated by its own permission —
// shared by the roster row's ⋮ menu (StudentRow.tsx) and the student page's Actions
// dropdown (StudentPage.tsx). Returns the menu items plus
// the dialogs they open, which the caller renders alongside its menu.
export function useStudentActions(
  student: StudentStatus | null,
  handlers: {
    onTransferMembership: (planId: string, targetEmail: string) => Promise<void>;
    onSetSuspended: (suspended: boolean) => Promise<void>;
  }
): { items: { label: string; onClick: () => void }[]; dialogs: ReactNode } {
  const [transferOpen, setTransferOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const { has } = usePermissions();
  const canTransfer = has("Write Memberships");
  const canSuspend = has("Suspend Students");

  if (!student) return { items: [], dialogs: null };

  const items = [
    ...(canTransfer ? [{ label: "Transfer membership", onClick: () => setTransferOpen(true) }] : []),
    ...(canSuspend
      ? [{ label: student.suspended ? "Unsuspend" : "Suspend", onClick: () => setSuspendOpen(true) }]
      : []),
  ];

  const dialogs = (
    <>
      {canTransfer && transferOpen && (
        <TransferDialog
          student={student}
          onSubmit={handlers.onTransferMembership}
          onClose={() => setTransferOpen(false)}
        />
      )}
      {canSuspend && suspendOpen && (
        <SuspendDialog
          student={student}
          onSubmit={() => handlers.onSetSuspended(!student.suspended)}
          onClose={() => setSuspendOpen(false)}
        />
      )}
    </>
  );

  return { items, dialogs };
}
