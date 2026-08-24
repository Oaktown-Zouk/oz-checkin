import { config } from "../config.js";

const BASE_URL = "https://api.airtable.com/v0";

export interface AirtableRecord<F = Record<string, unknown>> {
  id: string;
  createdTime: string;
  fields: F;
}

function encodeTable(table: string): string {
  return encodeURIComponent(table);
}

// Airtable's rate limit is 5 req/sec per base — back off and retry on 429 rather than
// surfacing a transient limit as a user-facing failure.
async function request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const res = await fetch(`${BASE_URL}/${config.AIRTABLE_BASE_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.AIRTABLE_PAT}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return request<T>(path, init, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<T>;
}

export interface ListOptions {
  filterByFormula?: string;
  fields?: string[];
  sort?: { field: string; direction?: "asc" | "desc" }[];
}

export async function listRecords<F = Record<string, unknown>>(
  table: string,
  opts: ListOptions = {}
): Promise<AirtableRecord<F>[]> {
  const records: AirtableRecord<F>[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams();
    if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    if (opts.fields) for (const f of opts.fields) params.append("fields[]", f);
    if (opts.sort) {
      opts.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        params.set(`sort[${i}][direction]`, s.direction ?? "asc");
      });
    }
    if (offset) params.set("offset", offset);

    const page = await request<{ records: AirtableRecord<F>[]; offset?: string }>(
      `/${encodeTable(table)}?${params.toString()}`
    );
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  return records;
}

export async function getRecord<F = Record<string, unknown>>(
  table: string,
  id: string
): Promise<AirtableRecord<F>> {
  return request<AirtableRecord<F>>(`/${encodeTable(table)}/${id}`);
}

export async function getRecordOrNull<F = Record<string, unknown>>(
  table: string,
  id: string
): Promise<AirtableRecord<F> | null> {
  try {
    return await getRecord<F>(table, id);
  } catch {
    return null;
  }
}

// Airtable's batch-create endpoint accepts up to 10 records per call — plenty for
// "check into several classes at once," the only caller that needs more than one.
export async function createRecords<F = Record<string, unknown>>(
  table: string,
  records: Partial<F>[]
): Promise<AirtableRecord<F>[]> {
  const result = await request<{ records: AirtableRecord<F>[] }>(`/${encodeTable(table)}`, {
    method: "POST",
    body: JSON.stringify({ records: records.map((fields) => ({ fields })) }),
  });
  return result.records;
}

export async function updateRecord<F = Record<string, unknown>>(
  table: string,
  id: string,
  fields: Partial<F>
): Promise<AirtableRecord<F>> {
  return request<AirtableRecord<F>>(`/${encodeTable(table)}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}
