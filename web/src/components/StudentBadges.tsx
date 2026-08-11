import type { StudentStatus } from "../api.js";

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function StudentBadges({ student }: { student: StudentStatus }) {
  const hasMembership = Boolean(student.membership);
  const hasCredits = Boolean(student.credits);
  const hasAnyPayment = hasMembership || hasCredits;
  const creditsAvailable = student.credits?.available ?? 0;
  const isNewMember = !student.everCheckedIn;

  return (
    <div className="badges">
      <span className={`badge ${student.waiver.signed ? "badge-green" : "badge-red"}`}>
        {student.waiver.signed ? "Waiver signed" : "No waiver"}
      </span>

      {student.membership && (
        <span className={`badge ${student.membership.active ? "badge-green" : "badge-gray"}`}>
          {student.membership.active
            ? "Member"
            : // Pausing doesn't retroactively revoke a month already paid for — showing the
              // last payment date lets front desk judge that themselves instead of us
              // guessing at "is this paid for the currently-viewed month" (too fuzzy).
              `Member (${student.membership.status}` +
              (student.membership.lastPaymentAt
                ? `, paid ${formatShortDate(student.membership.lastPaymentAt)})`
                : ")")}
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

      {isNewMember && <span className="badge badge-blue">New Member</span>}
    </div>
  );
}
