import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getStaffSession: vi.fn() }));

const { safeNextPath } = await import("./guards");

describe("safeNextPath", () => {
  it("allows admin paths", () => {
    expect(safeNextPath("/admin/reservations?status=pending")).toBe("/admin/reservations?status=pending");
  });

  it("rejects open redirects and loops", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/rooms", "/admin/login", "/admin/auth/confirm", "", null]) {
      expect(safeNextPath(bad)).toBe("/admin");
    }
  });
});
