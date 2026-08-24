import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  // The origin the *browser* actually sees (not necessarily the origin this process
  // listens on) — used to build the OAuth redirect_uri and the post-login redirect.
  // Can't be derived from the incoming request: in two-terminal dev the browser talks
  // to Vite on :5173, which proxies /api to this process on :3000, so the request this
  // process sees has the wrong origin. e.g. http://localhost:5173 (two-terminal dev),
  // http://localhost:8888 (netlify dev), or the production domain.
  APP_ORIGIN: z.string().url("APP_ORIGIN must be a full origin, e.g. http://localhost:8888"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  AIRTABLE_PAT: z.string().min(1, "AIRTABLE_PAT is required"),
  AIRTABLE_BASE_ID: z.string().min(1, "AIRTABLE_BASE_ID is required"),
  // Opt-in escape hatch for local dev only — see routes/auth.ts's dev-login route.
  // Requires BOTH this AND NODE_ENV !== "production" to actually activate, so it can't
  // go live from a single misconfigured var. Unset/anything but "true" = off.
  DEV_LOGIN_ENABLED: z.string().optional(),
  // Runs the app against an in-memory mock of Airtable instead of the real base — see
  // airtable/client.ts. Same NODE_ENV !== "production" gating as DEV_LOGIN_ENABLED,
  // for the same reason: a single misconfigured var must never fake out production.
  MOCK_AIRTABLE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
