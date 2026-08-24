import { Hono } from "hono";
import { config } from "../config.js";
import { resetMockStore } from "../airtable/mockClient.js";
import { buildSandboxSeed } from "../airtable/sandboxSeed.js";

export const devRoutes = new Hono();

const isProd = process.env.NODE_ENV === "production";

// Reseeds the mock back to its default fixtures — for me (or you) to get back to a
// known state while iterating in the sandbox without restarting the whole server, and
// for Playwright specs to reset between tests. Same gating as dev-login: only wired
// up at all (not just guarded inside the handler) when MOCK_AIRTABLE is active AND
// NODE_ENV !== "production", so a misconfigured var can't wipe production data — not
// that it could anyway, since this only ever touches the in-memory mock.
if (config.MOCK_AIRTABLE === "true" && !isProd) {
  devRoutes.post("/dev/reset-mock", (c) => {
    resetMockStore(buildSandboxSeed());
    return c.json({ ok: true });
  });
}
