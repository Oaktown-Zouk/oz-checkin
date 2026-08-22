import type { StudentStatus } from "../api.js";

// The membership tier or credits-remaining badge — shared between the roster row and
// the check-in dialog (where it helps front desk see how many classes are left before
// picking classes for the student).
export function MembershipBadge({ student }: { student: StudentStatus }) {
  // "Active" — a live membership covers check-in, nothing gets spent. "Paid" — no
  // active membership, but a recent drop-in/check-in means they're not a stranger.
  // "Inactive" gets no badge at all (dropped per product decision) — check-in still
  // works either way (front desk override), and flags for review once credits run out
  // too. See docs/airtable-schema.md, Members.Access Status.
  const isMember = student.accessStatus === "Active";
  const accessLabel = isMember ? "Member" : student.accessStatus === "Paid" ? "Paid" : null;
  const accessClass = isMember ? "badge-green" : "badge-gray";

  // One combined badge instead of two — the tier only matters alongside an access
  // label; shown alone (no access label) for an Inactive student who still nominally
  // has a tier from a lapsed membership. Active members get "N Class Membership"
  // (capitalized, count first, always singular "Class" regardless of count) to match
  // the "N credits available" pattern below, in a higher-contrast badge — this is the
  // single most important thing on the row.
  const combinedLabel =
    isMember && student.tierName
      ? `${student.tierName.replace(/class(es)?/i, "Class")} Membership`
      : accessLabel && student.tierName
        ? `${accessLabel} - ${student.tierName}`
        : (accessLabel ?? student.tierName);
  const combinedClass =
    isMember && student.tierName ? "badge-green badge-prominent" : accessLabel ? accessClass : "badge-blue";

  // Credits only matter once a membership isn't already covering check-in — showing
  // them alongside an active membership would just be confusing, unused information.
  const showCredits = student.accessStatus !== "Active";

  return (
    <>
      {combinedLabel && <span className={`badge ${combinedClass}`}>{combinedLabel}</span>}
      {showCredits && (
        <span className={`badge badge-prominent ${student.availableCredits > 0 ? "badge-green" : "badge-amber"}`}>
          {student.availableCredits > 0
            ? `${student.availableCredits} credit${student.availableCredits === 1 ? "" : "s"} available`
            : "No credits remaining"}
        </span>
      )}
    </>
  );
}
