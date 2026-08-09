import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { runSync, getSyncStatus } from "../services/sync.js";

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", { preHandler: requireAuth }, async () => {
    return runSync();
  });

  app.get("/status", { preHandler: requireAuth }, async () => {
    return getSyncStatus();
  });
};
