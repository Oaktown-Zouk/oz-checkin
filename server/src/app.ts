import { Hono } from "hono";
import { authRoutes } from "./routes/auth.js";
import { studentRoutes } from "./routes/students.js";
import { checkinRoutes } from "./routes/checkins.js";
import { programRoutes } from "./routes/programs.js";
import { kioskRoutes } from "./routes/kiosk.js";
import { devRoutes } from "./routes/dev.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api", authRoutes);
app.route("/api/students", studentRoutes);
app.route("/api/checkins", checkinRoutes);
app.route("/api/programs", programRoutes);
app.route("/api/kiosk", kioskRoutes);
app.route("/api", devRoutes);

export default app;
