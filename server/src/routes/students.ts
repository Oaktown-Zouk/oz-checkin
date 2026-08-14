import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { listStudentStatuses, updateStudentLevel } from "../services/studentStatus.js";
import { mergeStudents } from "../services/merge.js";
import { getStudentTimeline } from "../services/studentTimeline.js";
import { HttpError } from "../lib/errors.js";
import { isValidDateString } from "../lib/date.js";

const VALID_LEVELS = [1, 2, 3, 4];

// null means "unset"; anything else must be one of VALID_LEVELS.
function isValidLevel(level: unknown): level is number | null {
  return level === null || (typeof level === "number" && VALID_LEVELS.includes(level));
}

export const studentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: requireAuth }, async (req, reply) => {
    const { q, date } = req.query as { q?: string; date?: string };
    if (date !== undefined && !isValidDateString(date)) {
      return reply.code(400).send({ error: "date must be YYYY-MM-DD" });
    }
    return listStudentStatuses({ query: q, date });
  });

  app.get("/:id/timeline", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const timeline = await getStudentTimeline(Number(id));
    if (!timeline) return reply.code(404).send({ error: "Student not found" });
    return timeline;
  });

  app.patch("/:id/lead-level", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { level } = req.body as { level?: unknown };
    if (!isValidLevel(level)) {
      return reply.code(400).send({ error: "level must be 1-4 or null" });
    }
    try {
      return await updateStudentLevel(Number(id), "leadLevel", level);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.patch("/:id/follow-level", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { level } = req.body as { level?: unknown };
    if (!isValidLevel(level)) {
      return reply.code(400).send({ error: "level must be 1-4 or null" });
    }
    try {
      return await updateStudentLevel(Number(id), "followLevel", level);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
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
