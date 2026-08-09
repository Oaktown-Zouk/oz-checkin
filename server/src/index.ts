import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cron from "node-cron";
import { config, googleFormsConfigured, givebutterConfigured } from "./config.js";
import { registerSession } from "./lib/session.js";
import { authRoutes } from "./routes/auth.js";
import { studentRoutes } from "./routes/students.js";
import { checkinRoutes } from "./routes/checkins.js";
import { syncRoutes } from "./routes/sync.js";
import { runSync } from "./services/sync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({ logger: true });

  await registerSession(app);

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: "/api" });
  await app.register(studentRoutes, { prefix: "/api/students" });
  await app.register(checkinRoutes, { prefix: "/api/checkins" });
  await app.register(syncRoutes, { prefix: "/api/sync" });

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

  if (googleFormsConfigured || givebutterConfigured) {
    cron.schedule(`*/${config.SYNC_INTERVAL_MINUTES} * * * *`, () => {
      app.log.info("Running scheduled sync");
      runSync().catch((err) => app.log.error(err, "Scheduled sync failed"));
    });
    // Kick off an initial sync shortly after boot rather than waiting a full interval.
    setTimeout(() => {
      runSync().catch((err) => app.log.error(err, "Initial sync failed"));
    }, 2000);
  } else {
    app.log.warn(
      "Neither Google Forms nor Givebutter is configured — running with local data only. See README."
    );
  }

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
