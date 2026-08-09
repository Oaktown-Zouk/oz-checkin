import { createHash } from "node:crypto";
import fastifySecureSession from "@fastify/secure-session";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export async function registerSession(app: FastifyInstance) {
  // Derive a 32-byte key from SESSION_SECRET so any secret length works, rather than
  // requiring the operator to hand-generate a key/salt pair for a single-password app.
  const key = createHash("sha256").update(config.SESSION_SECRET).digest();

  await app.register(fastifySecureSession, {
    key,
    cookieName: "oz_session",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    },
  });
}
