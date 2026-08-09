import { db } from "../db/client.js";
import { syncState } from "../db/schema.js";
import { broadcastChange } from "../lib/events.js";
import { syncGoogleForms } from "./googleForms.js";
import { syncGivebutter } from "./givebutter.js";

let syncInFlight: Promise<unknown> | null = null;

export async function runSync() {
  // Coalesce concurrent triggers (cron tick + manual "Refresh now" click) into one run.
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const [forms, givebutter] = await Promise.all([
      syncGoogleForms().catch((err) => ({ skipped: false, error: String(err) })),
      syncGivebutter().catch((err) => ({ skipped: false, error: String(err) })),
    ]);
    return { forms, givebutter };
  })();

  try {
    const result = await syncInFlight;
    // Covers both triggers (cron tick and the manual "Refresh now" button) with one
    // broadcast, since both funnel through here.
    broadcastChange("sync");
    return result;
  } finally {
    syncInFlight = null;
  }
}

export async function getSyncStatus() {
  const rows = await db.select().from(syncState);
  const bySource = Object.fromEntries(rows.map((r) => [r.source, r]));
  return {
    google_forms: bySource.google_forms?.lastSyncedAt?.toISOString() ?? null,
    givebutter: bySource.givebutter?.lastSyncedAt?.toISOString() ?? null,
  };
}
