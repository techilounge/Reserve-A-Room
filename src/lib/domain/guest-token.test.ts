import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { generateGuestToken, hashGuestToken, isWellFormedGuestToken } = await import("./guest-token");

describe("guest tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateGuestToken));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("hash to the Postgres bytea hex format that matches sha256()", () => {
    const token = generateGuestToken();
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashGuestToken(token)).toBe(`\\x${expected}`);
  });

  it("recognizes only well-formed tokens", () => {
    expect(isWellFormedGuestToken(generateGuestToken())).toBe(true);
    expect(isWellFormedGuestToken("short")).toBe(false);
    expect(isWellFormedGuestToken(`${"a".repeat(42)}!`)).toBe(false);
    expect(isWellFormedGuestToken(undefined)).toBe(false);
  });
});
