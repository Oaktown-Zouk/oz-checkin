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
  // coversCheckIn is computed server-side (active, or paused/etc. but paid within the
  // last 30 days) and drives the actual check-in spend decision too — see
  // services/studentStatus.ts. Kept in one place so the badge can't say "covered" while
  // the real check-in still quietly spends a credit, or vice versa.
  const membershipCoversCheckIn = student.membership?.coversCheckIn ?? false;

  return (
    <div className="badges">
      <span className={`badge ${student.waiver.signed ? "badge-green" : "badge-red"}`}>
        {student.waiver.signed ? "Waiver signed" : "No waiver"}
      </span>

      {student.membership && (
        <span
          className={`badge ${
            student.membership.active
              ? "badge-green"
              : membershipCoversCheckIn
                ? "badge-gray"
                : "badge-red"
          }`}
        >
          {student.membership.active
            ? "Member"
            : // Showing the last payment date lets front desk judge for themselves whether
              // it's good for the currently-viewed month, rather than us guessing (too fuzzy).
              `Member (${student.membership.status}` +
              (student.membership.lastPaymentAt
                ? `, paid ${formatShortDate(student.membership.lastPaymentAt)})`
                : ")")}
        </span>
      )}

      {/* Hidden once the membership covers this check-in (active, or paused-but-recently-
          paid) — the check-in will be counted against the membership, not a credit, so
          showing a credit count here would just be confusing, unused information. */}
      {student.credits && !membershipCoversCheckIn && (
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
