import type { StudentStatus } from "../types.js";

// The membership tier or credits-remaining badge — shared between the roster row, the
// check-in dialogs, and the student pages.
export function MembershipBadge({
  student,
  // Roster rows stay one-badge-per-student on purpose — a member's leftover credit
  // is real but secondary information there, and showing it on every row would be
  // clutter across a whole list. The check-in dialogs and the student detail/self-
  // service pages are single-student contexts where that same credit is actionable
  // (front desk/the student themselves deciding what a check-in will consume), so
  // they opt in explicitly. Defaults to off so any new call site starts conservative.
  showBothWhenApplicable = false,
}: {
  student: StudentStatus;
  showBothWhenApplicable?: boolean;
}) {
  // "Active" — a live membership covers check-in, nothing gets spent. "Paid" — no
  // active membership, but a recent drop-in/check-in means they're not a stranger.
  // "Inactive" gets no badge at all (dropped per product decision) — check-in still
  // works either way (front desk override), and flags for review once credits run out
  // too. See docs/airtable-schema.md, Members.Access Status.
  //
  // Also requires a resolved tierName, not just Access Status = Active — Airtable's
  // Tier Rule link is maintained by an automation that runs when Membership Amount is
  // updated (see docs/airtable-schema.md, "Tier Rule gaps"), which can miss a member
  // (e.g. the amount was only ever set, never changed after) or have no Tier to match
  // at all. Rather than show a bare, informationless "Member" badge in that gap, treat
  // them as a non-member for display purposes and fall through to credits — that's
  // the actionable info front desk actually needs.
  const isMember = student.accessStatus === "Active" && !!student.tierName;
  const accessLabel = isMember ? "Member" : student.accessStatus === "Paid" ? "Paid" : null;
  const accessClass = isMember ? "badge-green" : "badge-gray";

  // One combined badge instead of two — the tier only matters alongside an access
  // label; shown alone (no access label) for an Inactive student who still nominally
  // has a tier from a lapsed membership. Active members get "N Class Membership"
  // (capitalized, count first, always singular "Class" regardless of count) to match
  // the "N credits available" pattern below, in a higher-contrast badge — this is the
  // single most important thing on the row.
  const combinedLabel = isMember
    ? `${student.tierName!.replace(/class(es)?/i, "Class")} Membership`
    : accessLabel && student.tierName
      ? `${accessLabel} - ${student.tierName}`
      : (accessLabel ?? student.tierName);
  const combinedClass = isMember ? "badge-green badge-prominent" : accessLabel ? accessClass : "badge-blue";

  // Non-members always see their credits state (including "No credits remaining" —
  // that's actionable for them). A member's active membership already covers
  // check-in, so a credit-less member gets no redundant badge — but a member who
  // also has a credit on file (e.g. an unused signup credit, or a drop-in bought
  // before they upgraded to a membership) should still see it where that's not
  // clutter — see showBothWhenApplicable above.
  const showCredits = !isMember || (showBothWhenApplicable && student.availableCredits > 0);

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
