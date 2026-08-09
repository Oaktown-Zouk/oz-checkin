import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { createCheckIn, undoCheckIn } from "../services/checkins.js";
import { HttpError } from "../lib/errors.js";

export const checkinRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body as { studentId: number; paymentId?: number };
    try {
      return await createCheckIn(body.studentId, {
        paymentId: body.paymentId,
        // Single shared front-desk login for now (see SPEC.md auth section) — nothing
        // more specific to attribute a check-in to yet.
        checkedInBy: "front-desk",
      });
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.delete("/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await undoCheckIn(Number(id));
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
};
