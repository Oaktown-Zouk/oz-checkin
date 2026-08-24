import { useState } from "react";
import type { StudentStatus } from "../api.js";
import { usePermissions } from "../permissions.js";
import { LevelEditDialog } from "./LevelEditDialog.js";
import { LevelBadge } from "./LevelBadge.js";
import { MembershipBadge } from "./MembershipBadge.js";

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

      <MembershipBadge student={student} />
    </div>
  );
}
