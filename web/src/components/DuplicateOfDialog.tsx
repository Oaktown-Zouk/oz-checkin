import { useEffect, useMemo, useState } from "react";
import { api, type HeldMembership, type StudentStatus } from "../api.js";
import { Portal } from "shared";

const MAX_RESULTS = 8;

function formatMembership(m: HeldMembership): string {
  const amount = m.amount != null ? `, $${m.amount.toFixed(2)}/${m.frequency ?? "period"}` : "";
  return `${m.status} membership${amount}`;
}

function CandidateCard({ student, memberships }: { student: StudentStatus; memberships: HeldMembership[] | null }) {
  return (
    <div className="merge-candidate merge-candidate-selected">
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
    </div>
  );
}

// Points a student whose Givebutter contact was merged away (Removed From Givebutter)
// at the record Givebutter kept. Submitting sets Duplicate Of; an Airtable automation
// then moves check-ins, levels, etc. onto the kept record and hides this one from the
// roster. See server/src/services/merge.ts.
export function DuplicateOfDialog({
  student,
  allStudents,
  onSubmit,
  onClose,
}: {
  // The merged-away row this was opened from.
  student: StudentStatus;
  // The full, unfiltered roster — searched locally for the kept record, reusing data
  // App.tsx already fetched rather than a new request.
  allStudents: StudentStatus[];
  onSubmit: (duplicateId: string, survivorId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<HeldMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const survivor = useMemo(() => allStudents.find((s) => s.id === survivorId) ?? null, [allStudents, survivorId]);

  // Other merged-away rows can't be the kept record, so they're left out.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allStudents
      .filter((s) => s.id !== student.id && !s.removedFromGivebutter && s.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [allStudents, query, student.id]);

  useEffect(() => {
    if (!survivor) return;
    let cancelled = false;
    setMemberships(null);
    api
      .heldMemberships(survivor.id)
      .then((m) => {
        if (!cancelled) setMemberships(m);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load membership info for this student.");
      });
    return () => {
      cancelled = true;
    };
  }, [survivor]);

  function pickSurvivor(id: string | null) {
    setSurvivorId(id);
    setError(null);
  }

  async function handleSubmit() {
    if (!survivor) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(student.id, survivor.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark as duplicate");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Portal>
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog-card merge-dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Mark as duplicate</h2>

          {!survivor && (
            <>
              <p className="dialog-description">
                Givebutter merged {student.name}'s contact into another one. Find the record Givebutter
                kept — this record's check-ins and levels move onto it, and this one is hidden from the
                roster.
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
                    <button key={r.id} type="button" className="merge-search-result" onClick={() => pickSurvivor(r.id)}>
                      {r.name} · {r.email}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {survivor && (
            <>
              <p className="dialog-field-label">
                {student.name} ({student.email}) is a duplicate of:
              </p>
              <div className="merge-candidates">
                <CandidateCard student={survivor} memberships={memberships} />
              </div>
              <button type="button" className="link-button" onClick={() => pickSurvivor(null)}>
                Choose a different record
              </button>
            </>
          )}

          {error && <p className="error">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            {survivor && (
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Marking…" : "Mark as duplicate"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
