import { useState } from "react";
import type { StudentStatus } from "../api.js";
import { usePermissions } from "../permissions.js";
import { LevelEditDialog } from "./LevelEditDialog.js";
import { LevelBadge } from "./LevelBadge.js";

export function StudentBadges({
  student,
  onUpdateLeadLevel,
  onUpdateFollowLevel,
}: {
  student: StudentStatus;
  onUpdateLeadLevel: (level: number | null) => Promise<void>;
  onUpdateFollowLevel: (level: number | null) => Promise<void>;
}) {
  const [editingLevel, setEditingLevel] = useState<"lead" | "follow" | null>(null);
  const { has } = usePermissions();
  const canEditLevels = has("Write Student Data");

  // "Active" — a live membership covers check-in, nothing gets spent. "Paid" — no
  // active membership, but a recent drop-in/check-in means they're not a stranger.
  // "Inactive" gets no badge at all (dropped per product decision) — check-in still
  // works either way (front desk override), and flags for review once credits run out
  // too. See docs/airtable-schema.md, Members.Access Status.
  const accessLabel = student.accessStatus === "Active" ? "Member" : student.accessStatus === "Paid" ? "Paid" : null;
  const accessClass = student.accessStatus === "Active" ? "badge-green" : "badge-gray";

  // One combined badge ("Member - 1 class") instead of two — the tier only matters
  // alongside an access label; shown alone (no access label) for an Inactive student
  // who still nominally has a tier from a lapsed membership.
  const combinedLabel =
    accessLabel && student.tierName ? `${accessLabel} - ${student.tierName}` : (accessLabel ?? student.tierName);
  const combinedClass = accessLabel ? accessClass : "badge-blue";

  // Credits only matter once a membership isn't already covering check-in — showing
  // them alongside an active membership would just be confusing, unused information.
  const showCredits = student.accessStatus !== "Active";

  return (
    <div className="badges">
      <span className="student-levels">
        {canEditLevels ? (
          <>
            <button
              type="button"
              className="level-badge"
              title="Edit lead level"
              onClick={() => setEditingLevel("lead")}
            >
              <LevelBadge level={student.leadLevel} shape="square" />
            </button>
            <button
              type="button"
              className="level-badge"
              title="Edit follow level"
              onClick={() => setEditingLevel("follow")}
            >
              <LevelBadge level={student.followLevel} shape="circle" />
            </button>
          </>
        ) : (
          <>
            <LevelBadge level={student.leadLevel} shape="square" />
            <LevelBadge level={student.followLevel} shape="circle" />
          </>
        )}
      </span>

      {canEditLevels && editingLevel && (
        <LevelEditDialog
          title={editingLevel === "lead" ? "Edit Lead Level" : "Edit Follow Level"}
          currentLevel={editingLevel === "lead" ? student.leadLevel : student.followLevel}
          shape={editingLevel === "lead" ? "square" : "circle"}
          onSubmit={editingLevel === "lead" ? onUpdateLeadLevel : onUpdateFollowLevel}
          onClose={() => setEditingLevel(null)}
        />
      )}

      {combinedLabel && <span className={`badge ${combinedClass}`}>{combinedLabel}</span>}

      {showCredits && (
        <span className={`badge ${student.availableCredits > 0 ? "badge-green" : "badge-amber"}`}>
          {student.availableCredits > 0
            ? `${student.availableCredits} credit${student.availableCredits === 1 ? "" : "s"} available`
            : "No credits remaining"}
        </span>
      )}
    </div>
  );
}
