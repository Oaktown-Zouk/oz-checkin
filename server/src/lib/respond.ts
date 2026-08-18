import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "./errors.js";

// Shared catch-block for route handlers: HttpError (NotFoundError/ConflictError/etc.)
// becomes the matching JSON error response; anything else rethrows for Hono's default
// error handling.
export function handleError(c: Context, err: unknown): Response {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode);
  }
  throw err;
}
