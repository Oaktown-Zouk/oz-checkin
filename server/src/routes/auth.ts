import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (req, reply) => {
    const body = req.body as { password?: string } | undefined;
    if (!body?.password || body.password !== config.CHECKIN_PASSWORD) {
      return reply.code(401).send({ error: "Incorrect password" });
    }
    req.session.set("authenticated", true);
    return { ok: true };
  });

  app.post("/logout", async (req) => {
    req.session.delete();
    return { ok: true };
  });

  app.get("/session", async (req) => {
    return { authenticated: Boolean(req.session.get("authenticated")) };
  });
};
