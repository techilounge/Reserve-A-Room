import { describe, expect, it } from "vitest";

import { normalizeAuditDatePreset, resolveAuditDateRange } from "./audit-filters";

describe("audit filters", () => {
  it("normalizes unsupported presets", () => {
    expect(normalizeAuditDatePreset("last_7_days")).toBe("last_7_days");
    expect(normalizeAuditDatePreset("forever")).toBe("all");
  });

  it("creates inclusive local-day boundaries in the application timezone", () => {
    expect(
      resolveAuditDateRange({
        preset: "today",
        timeZone: "America/Chicago",
        now: new Date("2026-09-26T17:00:00Z"),
      }),
    ).toEqual({
      from: "2026-09-26",
      to: "2026-09-26",
      fromInstant: "2026-09-26T05:00:00.000Z",
      toExclusiveInstant: "2026-09-27T05:00:00.000Z",
    });
  });

  it("supports open-ended custom ranges and rejects reversed ranges", () => {
    expect(
      resolveAuditDateRange({ preset: "custom", from: "2026-09-01", timeZone: "America/Chicago" }),
    ).toMatchObject({ from: "2026-09-01", fromInstant: "2026-09-01T05:00:00.000Z" });
    expect(
      resolveAuditDateRange({ preset: "custom", from: "2026-09-10", to: "2026-09-01", timeZone: "America/Chicago" }).error,
    ).toMatch(/start date/i);
  });
});
