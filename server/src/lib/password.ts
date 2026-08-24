// Password hashing for the kiosk password-login path (see routes/auth.ts) — the only
// place this app stores a password at all; everything else is Google OAuth. Uses
// Node's built-in `scrypt` rather than a bcrypt/argon2 dependency — OWASP's #2-ranked
// algorithm for password storage, and it matches this codebase's existing "no SDK,
// thin wrapper" preference (see airtable/realClient.ts).
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

// Node's own documented defaults — already a reasonable cost factor for an
// interactive login (not tuned down for speed, not tuned up into "makes every login
// noticeably slow" territory). Stored alongside every hash (see below) specifically
// so these can change later without invalidating passwords set under the old values.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const HEX_RE = /^[0-9a-f]+$/i;

// One self-describing string — algorithm, cost params, salt, and hash all together —
// the same approach bcrypt/argon2 use internally, so a stored hash is always
// verifiable on its own without a separate "what params was this made with" lookup.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

// Never throws — a malformed/tampered stored value (or a scrypt parameter error from
// one) is just a failed verification, not a server error.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(":");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts;

    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (!HEX_RE.test(saltHex) || !HEX_RE.test(hashHex)) return false;

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (salt.length === 0 || expected.length === 0) return false;

    const derivedKey = await scrypt(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(derivedKey, expected);
  } catch {
    return false;
  }
}
