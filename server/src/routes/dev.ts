import { Hono } from "hono";
import { config } from "../config.js";
import { resetMockStore } from "../airtable/mockClient.js";
import { buildSandboxSeed } from "../airtable/sandboxSeed.js";

export const devRoutes = new Hono();

const isProd = process.env.NODE_ENV === "production";

// Reseeds the mock back to its default fixtures — lets someone iterating in the
// sandbox get back to a known state without restarting the whole server, and lets
// Playwright specs reset between tests. Same gating as dev-login: only wired up at
// all (not just guarded inside the handler) when MOCK_AIRTABLE is active AND
// NODE_ENV !== "production", so a misconfigured var can't wipe production data — not
// that it could anyway, since this only ever touches the in-memory mock.
if (config.MOCK_AIRTABLE === "true" && !isProd) {
  devRoutes.post("/dev/reset-mock", (c) => {
    resetMockStore(buildSandboxSeed());
    return c.json({ ok: true });
  });
}
