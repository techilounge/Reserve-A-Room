import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { getServerEnv, isProductionDeployment } from "@/lib/env/server";

export { GUEST_TOKEN_COOKIE, isWellFormedGuestToken } from "./guest-cookie";

/**
 * Guest management links (ADR-9).
 *
 *   token = base64url(HMAC-SHA256(GUEST_LINK_SECRET, seed))   — 43 characters
 *
 * The database stores the random 16-byte seed and sha256(token). Lookups compare hashes;
 * the server can re-create the exact link for any later email (approval, retry…) from
 * the seed. A copy of the database alone yields no working links, because the secret
 * never leaves the server. Rotating GUEST_LINK_SECRET invalidates every existing link.
 */

function secret(): string {
  const configured = getServerEnv().GUEST_LINK_SECRET;
  if (configured) return configured;
  if (isProductionDeployment()) throw new Error("GUEST_LINK_SECRET must be set in production.");
  return "development-only-guest-link-secret";
}

export function tokenFromSeed(seed: Buffer): string {
  return createHmac("sha256", secret()).update(seed).digest("base64url");
}

/** Hash as sent to Postgres (bytea hex text accepted by PostgREST). */
export function hashGuestToken(token: string): string {
  return `\\x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

/** A new link for a new reservation: the token plus the values the database stores. */
export function newGuestToken(): { token: string; seed: string; hash: string } {
  const seed = randomBytes(16);
  const token = tokenFromSeed(seed);
  return { token, seed: `\\x${seed.toString("hex")}`, hash: hashGuestToken(token) };
}

/** Parses a bytea value as returned by PostgREST ("\x…" hex). */
export function seedFromDatabase(value: string): Buffer {
  return Buffer.from(value.replace(/^\\x/, ""), "hex");
}
