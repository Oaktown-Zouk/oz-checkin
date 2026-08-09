import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { listStudentStatuses } from "../services/studentStatus.js";
import { mergeStudents } from "../services/merge.js";
import { HttpError } from "../lib/errors.js";

export const studentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: requireAuth }, async (req) => {
    const { q } = req.query as { q?: string };
    return listStudentStatuses({ query: q });
  });

  app.post("/:id/merge", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { otherEmail?: string };
    if (!body?.otherEmail?.trim()) {
      return reply.code(400).send({ error: "otherEmail is required" });
    }
    try {
      return await mergeStudents(Number(id), body.otherEmail);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
};
