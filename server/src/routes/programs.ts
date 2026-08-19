import { Hono } from "hono";
import { requireAuth } from "../lib/auth.js";
import { listActivePrograms } from "../services/programs.js";

export const programRoutes = new Hono();
programRoutes.use("*", requireAuth);

programRoutes.get("/", async (c) => {
  return c.json(await listActivePrograms());
});
