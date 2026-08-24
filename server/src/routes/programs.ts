import { Hono } from "hono";
import { requirePermission } from "../lib/auth.js";
import { listActivePrograms } from "../services/programs.js";

export const programRoutes = new Hono();

programRoutes.get("/", requirePermission("Create Checkins"), async (c) => {
  return c.json(await listActivePrograms());
});
