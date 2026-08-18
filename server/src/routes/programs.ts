import { Hono } from "hono";
import { requireAuth } from "../lib/auth.js";
import { activePrograms } from "../services/programs.js";
import { isValidDateString } from "../lib/date.js";

export const programRoutes = new Hono();
programRoutes.use("*", requireAuth);

programRoutes.get("/today", async (c) => {
  const date = c.req.query("date");
  if (date !== undefined && !isValidDateString(date)) {
    return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  }
  return c.json(await activePrograms(date));
});
