import { config } from "../config.js";
import * as realClient from "./realClient.js";
import * as mockClient from "./mockClient.js";

export type { AirtableRecord, ListOptions } from "./realClient.js";
export { TABLES } from "./tableIds.js";

// Same gating as DEV_LOGIN_ENABLED (routes/auth.ts) — requires BOTH the flag AND
// NODE_ENV !== "production", so a single misconfigured env var can't run production
// against fake in-memory data. See mockClient.ts for what's actually simulated.
const useMock = config.MOCK_AIRTABLE === "true" && process.env.NODE_ENV !== "production";

if (useMock) {
  console.log("[airtable] MOCK_AIRTABLE active — running against the in-memory mock, not real Airtable.");
}

const impl = useMock ? mockClient : realClient;

export const listRecords: typeof realClient.listRecords = impl.listRecords;
export const getRecord: typeof realClient.getRecord = impl.getRecord;
export const getRecordOrNull: typeof realClient.getRecordOrNull = impl.getRecordOrNull;
export const createRecords: typeof realClient.createRecords = impl.createRecords;
export const updateRecord: typeof realClient.updateRecord = impl.updateRecord;
