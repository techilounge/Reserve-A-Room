import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("CALENDAR_PLAN_LINK_SECRET", "test-only-calendar-secret-not-for-production");
const { derivePlannerToken, hashPlannerBearer, newPlannerGrant, newPlannerSession, newPlannerToken } = await import("./token");

describe("calendar planning credentials", () => {
  it("reconstructs only the matching grant and version from a seed", () => {
    const grant = newPlannerGrant();
    const token = derivePlannerToken(grant.id, 1, grant.seed);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashPlannerBearer(token)).toBe(grant.hash);
    expect(derivePlannerToken(grant.id, 2, grant.seed)).not.toBe(token);
    expect(derivePlannerToken(crypto.randomUUID(), 1, grant.seed)).not.toBe(token);
    expect(newPlannerToken(grant.id, 2).hash).not.toBe(grant.hash);
  });

  it("creates distinct random session bearers whose hashes do not expose them", () => {
    const sessions = Array.from({ length: 100 }, () => newPlannerSession());
    expect(new Set(sessions.map((session) => session.bearer)).size).toBe(100);
    for (const session of sessions) {
      expect(session.bearer).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session.hash).toBe(hashPlannerBearer(session.bearer));
      expect(session.hash).not.toContain(session.bearer);
    }
  });
});
