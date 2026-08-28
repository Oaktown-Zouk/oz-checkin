import { useEffect, useMemo, useRef, useState } from "react";
import { api, type HeldMembership, type StudentStatus } from "../api.js";
import { Portal } from "shared";

const MAX_RESULTS = 8;

function formatMembership(m: HeldMembership): string {
  const amount = m.amount != null ? `, $${m.amount.toFixed(2)}/${m.frequency ?? "period"}` : "";
  return `${m.status} membership${amount}`;
}

function CandidateCard({
  student,
  memberships,
  selected,
  onSelect,
}: {
  student: StudentStatus;
  memberships: HeldMembership[] | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`merge-candidate${selected ? " merge-candidate-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="merge-candidate-name">{student.name}</div>
      <div className="merge-candidate-email">{student.email}</div>
      <div className="merge-candidate-detail">
        {memberships === null
          ? "Loading…"
          : memberships.length > 0
            ? memberships.map(formatMembership).join(", ")
            : "No membership"}
      </div>
      <div className="merge-candidate-detail">
        {student.availableCredits} credit{student.availableCredits === 1 ? "" : "s"} available
      </div>
    </button>
  );
}

// Combines two Member records that represent the same real person — e.g. a Givebutter
// sync creating a second row for a case-variant email — into one. The user picks
// which of the two survives (pre-selected toward whichever already has an active
// membership, since that's the side future billing/attendance should keep tracking
// against); the other is hidden from the roster afterward, not deleted. See
// server/src/services/merge.ts for the actual reassignment logic.
export function MergeDialog({
  student,
  allStudents,
  onSubmit,
  onClose,
}: {
  // The roster row this was opened from — one of the two merge candidates, not
  // necessarily the survivor (see the picker below).
  student: StudentStatus;
  // The full, unfiltered roster — searched locally to find the other half of the
  // duplicate pair, reusing data App.tsx already fetched rather than a new request.
  allStudents: StudentStatus[];
  onSubmit: (survivorId: string, duplicateId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [otherId, setOtherId] = useState<string | null>(null);
  const [survivorId, setSurvivorId] = useState<string>(student.id);
  const [memberships, setMemberships] = useState<Record<string, HeldMembership[] | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Tracks an explicit click on a candidate card, so the plan-based auto-pick below
  // never clobbers a choice the user already made themselves.
  const survivorTouchedRef = useRef(false);

  const other = useMemo(() => allStudents.find((s) => s.id === otherId) ?? null, [allStudents, otherId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allStudents.filter((s) => s.id !== student.id && s.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [allStudents, query, student.id]);

  function pickOther(id: string | null) {
    setOtherId(id);
    setSurvivorId(student.id);
    survivorTouchedRef.current = false;
    setError(null);
  }

  function chooseSurvivor(id: string) {
    survivorTouchedRef.current = true;
    setSurvivorId(id);
  }

  useEffect(() => {
    if (!other) return;
    let cancelled = false;
    setMemberships({ [student.id]: null, [other.id]: null });
    Promise.all([api.heldMemberships(student.id), api.heldMemberships(other.id)])
      .then(([mine, theirs]) => {
        if (cancelled) return;
        setMemberships({ [student.id]: mine, [other.id]: theirs });
        if (survivorTouchedRef.current) return;
        // Access Status is Airtable's own "has an active Recurring Plan" formula
        // (see docs/airtable-schema.md) — reused here rather than re-deriving
        // "active" from a plan's own Status string. Only overrides the default
        // (the row this dialog was opened from) when exactly one side has one.
        const mineActive = student.accessStatus === "Active";
        const theirsActive = other.accessStatus === "Active";
        if (theirsActive && !mineActive) setSurvivorId(other.id);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load membership info for one of these students.");
      });
    return () => {
      cancelled = true;
    };
  }, [other, student.id, student.accessStatus]);

  async function handleSubmit() {
    if (!other) return;
    const duplicateId = survivorId === student.id ? other.id : student.id;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(survivorId, duplicateId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog-card merge-dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Merge duplicate</h2>

          {!other && (
            <>
              <p className="dialog-description">
                Find the other record for {student.name} — the two will be combined into one, and
                the other will be hidden from the roster.
              </p>
              <input
                className="search-bar"
                type="search"
                autoFocus
                placeholder="Search by name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 && (
                <div className="merge-search-results">
                  {results.map((r) => (
                    <button key={r.id} type="button" className="merge-search-result" onClick={() => pickOther(r.id)}>
                      {r.name} · {r.email}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {other && (
            <>
              <p className="dialog-field-label">Which record should survive?</p>
              <div className="merge-candidates">
                <CandidateCard
                  student={student}
                  memberships={memberships[student.id] ?? null}
                  selected={survivorId === student.id}
                  onSelect={() => chooseSurvivor(student.id)}
                />
                <CandidateCard
                  student={other}
                  memberships={memberships[other.id] ?? null}
                  selected={survivorId === other.id}
                  onSelect={() => chooseSurvivor(other.id)}
                />
              </div>
              <button type="button" className="link-button" onClick={() => pickOther(null)}>
                Choose a different record
              </button>
            </>
          )}

          {error && <p className="error">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            {other && (
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Merging…" : "Merge"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
