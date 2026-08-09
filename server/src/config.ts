import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_PATH: z.string().default("./data/oz-checkin.sqlite"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  CHECKIN_PASSWORD: z.string().min(1, "CHECKIN_PASSWORD is required"),

  SYNC_INTERVAL_MINUTES: z.coerce.number().default(10),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_FORM_ID: z.string().optional(),
  GOOGLE_FORMS_EMAIL_QUESTION_ID: z.string().optional(),
  GOOGLE_FORMS_NAME_QUESTION_ID: z.string().optional(),

  GIVEBUTTER_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export const googleFormsConfigured = Boolean(
  config.GOOGLE_CLIENT_ID &&
    config.GOOGLE_CLIENT_SECRET &&
    config.GOOGLE_REFRESH_TOKEN &&
    config.GOOGLE_FORM_ID
);

export const givebutterConfigured = Boolean(config.GIVEBUTTER_API_KEY);
