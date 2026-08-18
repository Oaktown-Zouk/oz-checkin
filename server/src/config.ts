import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  // Only read by server/src/db/* now (kept around for the Phase 3 migration script,
  // which reads historical check-in/level data out of the old SQLite file) — the app
  // itself talks to Airtable, not this.
  DATABASE_PATH: z.string().default("./data/oz-checkin.sqlite"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  CHECKIN_PASSWORD: z.string().min(1, "CHECKIN_PASSWORD is required"),
  AIRTABLE_PAT: z.string().min(1, "AIRTABLE_PAT is required"),
  AIRTABLE_BASE_ID: z.string().min(1, "AIRTABLE_BASE_ID is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
