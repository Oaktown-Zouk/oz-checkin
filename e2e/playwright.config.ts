import { defineConfig } from "@playwright/test";

// The "two-terminal dev" pattern already used elsewhere in this codebase (see
// APP_ORIGIN's comment in server/src/config.ts), not `netlify dev` — Netlify
// Functions' dev emulation reloads the function module per invocation (correctly
// matching real serverless behavior), which wipes any in-memory mock state between
// requests. A single long-running node process doesn't have that problem, and E2E
// specs care about UI/business-logic behavior, not Netlify's deployment mechanics.
// The API has to run on :3000 specifically — web/vite.config.ts hardcodes its
// /api and /health proxy target there, it's not configurable via env. Only the
// frontend port is free to change, which is enough to dodge the Vite instance
// netlify dev (running on :8888) spawns for itself on :5173.
const API_PORT = 3000;
const WEB_PORT = 5299;

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  // All specs share one mock-backed server/store (there's no way to give each
  // worker/spec its own isolated backend without running N separate server
  // instances) — running workers in parallel would let one spec's beforeEach
  // reset-mock call race an in-flight assertion in another. Serial keeps it simple
  // and correct for a suite this size; revisit if the suite grows enough that this
  // becomes a real runtime cost.
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `PORT=${API_PORT} MOCK_AIRTABLE=true DEV_LOGIN_ENABLED=true APP_ORIGIN=http://localhost:${WEB_PORT} npm run dev --workspace server`,
      url: `http://localhost:${API_PORT}/health`,
      cwd: "..",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev --workspace web -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      cwd: "..",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
