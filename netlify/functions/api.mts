import { handle } from "hono/netlify";
import app from "../../server/src/app.js";

export default handle(app);

// Netlify Functions v2 path-based routing — this one function serves the whole API,
// same Hono `app` used by server/src/dev.ts for local (non-Netlify) dev.
export const config = {
  path: ["/api/*", "/health"],
};
