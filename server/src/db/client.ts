import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

// Uses Node's built-in node:sqlite (DatabaseSync) rather than better-sqlite3 — the
// latter has no prebuilt binary for current Node versions and compiles from source,
// which hit a native GC-timing crash (Statement finalization racing environment
// cleanup) under real load. node:sqlite ships inside Node itself, so there's no
// separate native module to get out of sync with the Node version.
mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

// Exported so index.ts can close it explicitly on shutdown — without that, the OS-level
// file lock isn't guaranteed to be released before a fast restart (dev-watch, a redeploy)
// tries to reopen the same file, which throws "database is locked" since node:sqlite
// doesn't retry on a busy lock by default (busy timeout defaults to 0).
export const sqlite = new DatabaseSync(config.DATABASE_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
// Foreign key enforcement defaults to on in node:sqlite (unlike better-sqlite3, which
// needed an explicit pragma).

// Not passing `schema` here — this app only uses the query-builder API
// (db.select/insert/update/delete against imported table objects), never the
// relational `db.query.*` API, and Drizzle 1.0's node-sqlite config no longer accepts
// `schema` on this path (it's for the relational API).
export const db = drizzle({ client: sqlite });
