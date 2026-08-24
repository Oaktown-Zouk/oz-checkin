// Local dev entrypoint, standing in for Netlify's function runtime (wired up in Phase
// 2's later step via netlify dev) — the same Hono `app` runs under both.
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import app from "./app.js";

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Dev server listening on http://localhost:${info.port}`);
});
