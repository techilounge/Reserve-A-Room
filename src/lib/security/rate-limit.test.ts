import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ RATE_LIMIT_SECRET: "test-rate-limit-secret" }),
  isProductionDeployment: () => false,
}));

const { hitRateLimit, RATE_LIMITS } = await import("./rate-limit");

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("hitRateLimit", () => {
  it("distinguishes allowed and denied database results", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(hitRateLimit(RATE_LIMITS.loginPerIp, "203.0.113.8")).resolves.toBe("allowed");

    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(hitRateLimit(RATE_LIMITS.loginPerIp, "203.0.113.8")).resolves.toBe("denied");
  });

  it("fails closed with an unavailable result and does not log the raw key", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "database offline" } });
    await expect(hitRateLimit(RATE_LIMITS.loginPerEmail, "private@example.org")).resolves.toBe("unavailable");

    const log = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(log).toContain("login:email");
    expect(log).not.toContain("private@example.org");
  });

  it("fails closed when the database returns no decision", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(hitRateLimit(RATE_LIMITS.loginPerIp, "203.0.113.8")).resolves.toBe("unavailable");
  });
});
