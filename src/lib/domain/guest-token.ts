import "server-only";

import { createHash, randomBytes } from "node:crypto";

export { GUEST_TOKEN_COOKIE, isWellFormedGuestToken } from "./guest-cookie";

/**
 * Guest management tokens (ADR-9). 32 random bytes (256 bits), base64url-encoded for the
 * emailed link. Only the SHA-256 hash is stored; a database leak can't be turned into
 * working links, and a high-entropy token needs no slow hash.
 */
export function generateGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash as sent to Postgres (bytea hex literal format understood by PostgREST). */
export function hashGuestToken(token: string): string {
  return `\\x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}
