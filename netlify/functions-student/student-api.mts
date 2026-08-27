import { handle } from "hono/netlify";
import studentApp from "../../server/src/studentApp.js";

export default handle(studentApp);

// Netlify Functions v2 path-based routing — this one function serves the whole
// student app's API, same studentApp used by server/src/devStudent.ts for local
// (non-Netlify) dev. See server/src/studentApp.ts for why this is a separate function
// from netlify/functions/api.mts rather than another route on the same one.
//
// web-student/functions/student-api.mts is a local-dev-only duplicate of this exact
// file (used by `npm run dev:netlify-student` — see web-student/netlify.toml's
// comment for why it can't just point here). Keep both identical if either changes.
export const config = {
  path: ["/api/*", "/health"],
};
