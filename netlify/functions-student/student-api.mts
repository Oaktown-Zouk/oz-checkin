import { handle } from "hono/netlify";
import studentApp from "../../server/src/studentApp.js";

export default handle(studentApp);

// Netlify Functions v2 path-based routing — this one function serves the whole
// student app's API, same studentApp used by server/src/devStudent.ts for local
// (non-Netlify) dev. See server/src/studentApp.ts for why this is a separate function
// from netlify/functions/api.mts rather than another route on the same one. Referenced
// by web-student/netlify.toml (the deployed student site's one config file, and also
// what `npm run dev:netlify-student` uses) — no separate copy needed here.
export const config = {
  path: ["/api/*", "/health"],
};
