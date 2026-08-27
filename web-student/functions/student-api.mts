import { handle } from "hono/netlify";
import studentApp from "../../server/src/studentApp.js";

export default handle(studentApp);

// Local-dev-only duplicate of netlify/functions-student/student-api.mts, used solely
// by `npm run dev:netlify-student` (see web-student/netlify.toml's comment) — Netlify
// refuses a toml's [functions] directory that points outside its own base directory,
// so this workspace needs its own physical copy rather than pointing at the real one.
// The deployed student site still uses the root-level netlify-student.toml +
// netlify/functions-student/student-api.mts; keep both files identical if either
// changes.
export const config = {
  path: ["/api/*", "/health"],
};
