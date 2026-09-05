// In-memory stand-in for realClient.ts, matching its exact exported function
// signatures so client.ts can swap between the two with zero changes to any
// services/*.ts caller. See mockCompute.ts for what gets computed vs. taken
// straight from fixture data, and the plan doc for the overall design rationale.
import type { AirtableRecord, ListOptions } from "./realClient.js";
import { TABLES } from "./tableIds.js";
import { evaluateFormula } from "./mockFormula.js";
import { computeMemberFields, type RawRecord, type SeedData, type Store } from "./mockCompute.js";
import { buildSandboxSeed } from "./sandboxSeed.js";

let store: Store = new Map();
let seeded = false;

function tableMap(tableId: string): Map<string, RawRecord> {
  let t = store.get(tableId);
  if (!t) {
    t = new Map();
    store.set(tableId, t);
  }
  return t;
}

// Applies the live-computed fields for tables that have any (just Members) — every
// other table's fields are fixture-static, returned exactly as stored.
function withComputedFields(tableId: string, record: RawRecord): Record<string, unknown> {
  if (tableId === TABLES.members) return computeMemberFields(record, store);
  return record.fields;
}

function project(fields: Record<string, unknown>, only?: string[]): Record<string, unknown> {
  if (!only || only.length === 0) return fields;
  const out: Record<string, unknown> = {};
  for (const key of only) if (key in fields) out[key] = fields[key];
  return out;
}

function toAirtableRecord<F>(tableId: string, record: RawRecord, only?: string[]): AirtableRecord<F> {
  return {
    id: record.id,
    createdTime: record.createdTime,
    fields: project(withComputedFields(tableId, record), only) as F,
  };
}

// Resets the store to exactly this seed — used by tests (fresh, tailored fixtures
// per test) and by the dev-only reset-mock route (back to the default sandbox seed).
export function resetMockStore(seed: SeedData): void {
  store = new Map();
  for (const [tableId, records] of Object.entries(seed)) {
    const t = tableMap(tableId);
    for (const r of records ?? []) {
      t.set(r.id, { id: r.id, createdTime: r.createdTime ?? new Date().toISOString(), fields: { ...r.fields } });
    }
  }
  seeded = true;
}

function ensureSeeded(): void {
  if (seeded) return;
  resetMockStore(buildSandboxSeed());
}

function newRecordId(): string {
  return `rec${Math.random().toString(36).slice(2, 18).padEnd(16, "0")}`;
}

export async function listRecords<F = Record<string, unknown>>(
  table: string,
  opts: ListOptions = {}
): Promise<AirtableRecord<F>[]> {
  ensureSeeded();
  let records = [...tableMap(table).values()];

  if (opts.filterByFormula) {
    records = records.filter((r) => evaluateFormula(opts.filterByFormula!, { id: r.id, fields: withComputedFields(table, r) }));
  }

  if (opts.sort) {
    records = records.slice().sort((a, b) => {
      for (const s of opts.sort!) {
        const av = withComputedFields(table, a)[s.field];
        const bv = withComputedFields(table, b)[s.field];
        const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        if (cmp !== 0) return s.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  return records.map((r) => toAirtableRecord<F>(table, r, opts.fields));
}

export async function getRecord<F = Record<string, unknown>>(table: string, id: string): Promise<AirtableRecord<F>> {
  ensureSeeded();
  const record = tableMap(table).get(id);
  if (!record) throw new Error(`mockClient: no record ${id} in table ${table}`);
  return toAirtableRecord<F>(table, record);
}

export async function getRecordOrNull<F = Record<string, unknown>>(
  table: string,
  id: string
): Promise<AirtableRecord<F> | null> {
  ensureSeeded();
  const record = tableMap(table).get(id);
  return record ? toAirtableRecord<F>(table, record) : null;
}

export async function createRecords<F = Record<string, unknown>>(
  table: string,
  records: Partial<F>[]
): Promise<AirtableRecord<F>[]> {
  ensureSeeded();
  const t = tableMap(table);
  const created: RawRecord[] = records.map((fields) => {
    const record: RawRecord = { id: newRecordId(), createdTime: new Date().toISOString(), fields: { ...fields } };
    t.set(record.id, record);
    return record;
  });

  // No automation simulation here — services/checkins.ts gates and consumes/flags
  // credits itself for every check-in (live or backdated), via plain
  // listRecords/updateRecord calls this mock already serves.

  return created.map((r) => toAirtableRecord<F>(table, r));
}

export async function updateRecord<F = Record<string, unknown>>(
  table: string,
  id: string,
  fields: Partial<F>
): Promise<AirtableRecord<F>> {
  ensureSeeded();
  const record = tableMap(table).get(id);
  if (!record) throw new Error(`mockClient: no record ${id} in table ${table}`);

  // No automation simulation here — services/checkins.ts gates and consumes/flags
  // credits itself for every check-in (live or backdated), via plain
  // listRecords/updateRecord calls this mock already serves.
  Object.assign(record.fields, fields);

  return toAirtableRecord<F>(table, record);
}

// Note: unlike updateRecord above, this does NOT simulate Airtable's automatic
// reverse-link cleanup (e.g. a deleted Credit vanishing from a Check-in's own
// Credits field) — no current caller deletes a record with an active reverse link
// pointing at it. Add that if a future caller needs it.
export async function deleteRecord(table: string, id: string): Promise<void> {
  ensureSeeded();
  tableMap(table).delete(id);
}
