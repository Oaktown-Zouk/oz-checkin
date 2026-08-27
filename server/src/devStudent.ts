// Local dev entrypoint for the student app, mirroring dev.ts — standing in for
// Netlify's function runtime. Loads server/.env.student *before* anything imports
// config.js (whose own `import "dotenv/config"` only loads the default .env, and
// dotenv never overrides a var that's already set) — this is what gives the student
// app its own APP_ORIGIN/port and, per SPEC.md, its own separate read-only
// AIRTABLE_PAT locally, matching the isolation the real deployment has.
import dotenv from "dotenv";
dotenv.config({ path: ".env.student" });

const { serve } = await import("@hono/node-server");
const { config } = await import("./config.js");
const { studentApp } = await import("./studentApp.js");

serve({ fetch: studentApp.fetch, port: config.PORT }, (info) => {
  console.log(`Student dev server listening on http://localhost:${info.port}`);
});
