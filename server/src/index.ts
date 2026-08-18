import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { registerSession } from "./lib/session.js";
import { requireAuth } from "./lib/auth.js";
import { addSseClient, removeSseClient, closeAllSseClients } from "./lib/events.js";
import { sqlite } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { studentRoutes } from "./routes/students.js";
import { checkinRoutes } from "./routes/checkins.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({ logger: true });

  await registerSession(app);

  // Regenerated every process start — sent as the first SSE event on every /api/events
  // connection (including reconnects), so the frontend can tell "the connection dropped
  // and came back because the server actually restarted" apart from a transient network
  // blip (same server -> same bootId -> no reload) and reload itself to pick up new
  // frontend assets. Also exposed on /health as a plain ops health-check convenience.
  const bootId = randomUUID();
  app.get("/health", async () => ({ ok: true, bootId }));

  // Server-Sent Events: push "something changed" to every open tab instead of each tab
  // polling on a timer. One persistent connection per tab; broadcastChange() (called
  // from the checkin/merge/sync services after a real write) fans out to all of them.
  app.get("/api/events", { preHandler: requireAuth }, (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    reply.raw.write(`event: boot\ndata: ${JSON.stringify({ bootId })}\n\n`);

    addSseClient(reply.raw);
    // Idle connections get closed by some proxies/browsers without periodic traffic;
    // a comment line is invisible to EventSource's event/message parsing.
    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);

    req.raw.on("close", () => {
      clearInterval(keepAlive);
      removeSseClient(reply.raw);
    });
  });

  await app.register(authRoutes, { prefix: "/api" });
  await app.register(studentRoutes, { prefix: "/api/students" });
  await app.register(checkinRoutes, { prefix: "/api/checkins" });

  // Serves the built React SPA (npm run build) — see README for the dev-mode setup,
  // where the Vite dev server runs separately and proxies /api here instead.
  const webDist = join(__dirname, "../../web/dist");
  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith("/api")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  // Close the DB connection explicitly before exiting — otherwise a fast restart
  // (dev-watch, a redeploy) can try to reopen the same file before the OS has released
  // the previous process's lock, which node:sqlite surfaces as "database is locked"
  // rather than retrying (its busy timeout defaults to 0). Also drain SSE connections
  // first since they're long-lived and would otherwise block app.close() from settling.
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    closeAllSseClients();
    await app.close();
    sqlite.close();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
