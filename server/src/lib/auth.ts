import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.get("authenticated")) {
    reply.code(401).send({ error: "Unauthorized" });
  }
}
