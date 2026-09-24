import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hashGuestToken, isWellFormedGuestToken, newGuestToken, seedFromDatabase, tokenFromSeed } = await import("./guest-token");

describe("guest tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newGuestToken().token));
    expect(tokens.size).toBe(500);
    for (const token of tokens) {
      expect(isWellFormedGuestToken(token)).toBe(true);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("can be re-created from the stored seed (for later emails and retries)", () => {
    const { token, seed, hash } = newGuestToken();
    expect(seed).toMatch(/^\\x[0-9a-f]{32}$/);
    expect(tokenFromSeed(seedFromDatabase(seed))).toBe(token);
    expect(hashGuestToken(tokenFromSeed(seedFromDatabase(seed)))).toBe(hash);
  });

  it("hash to the Postgres bytea hex format that matches sha256()", () => {
    const { token } = newGuestToken();
    expect(hashGuestToken(token)).toBe(`\\x${createHash("sha256").update(token).digest("hex")}`);
  });

  it("depend on the server secret, so a leaked seed alone is useless", () => {
    const seed = Buffer.alloc(16, 7);
    const withDefault = tokenFromSeed(seed);
    vi.stubEnv("GUEST_LINK_SECRET", "a-different-secret");
    vi.resetModules();
    return import("./guest-token").then((fresh) => {
      expect(fresh.tokenFromSeed(seed)).not.toBe(withDefault);
      vi.unstubAllEnvs();
    });
  });

  it("recognizes only well-formed tokens", () => {
    expect(isWellFormedGuestToken("short")).toBe(false);
    expect(isWellFormedGuestToken(`${"a".repeat(42)}!`)).toBe(false);
    expect(isWellFormedGuestToken(undefined)).toBe(false);
  });
});
