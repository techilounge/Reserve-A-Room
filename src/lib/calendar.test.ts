import { describe, expect, it } from "vitest";

import { dayOfWeek, datesBetween, shiftAnchor, viewRange } from "./calendar";

describe("calendar ranges", () => {
  it("knows the day of week", () => {
    expect(dayOfWeek("2026-10-04")).toBe(0); // Sunday
    expect(dayOfWeek("2026-10-10")).toBe(6); // Saturday
  });

  it("pads month views to whole Sunday–Saturday weeks", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(viewRange("month", "2026-10-15")).toEqual({ from: "2026-09-27", to: "2026-10-31" });
    expect(datesBetween("2026-09-27", "2026-10-31")).toHaveLength(35);
  });

  it("computes week and day ranges", () => {
    expect(viewRange("week", "2026-10-15")).toEqual({ from: "2026-10-11", to: "2026-10-17" });
    expect(viewRange("day", "2026-10-15")).toEqual({ from: "2026-10-15", to: "2026-10-15" });
  });

  it("moves between periods", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("week", "2026-10-15", -1)).toBe("2026-10-08");
    expect(shiftAnchor("day", "2026-12-31", 1)).toBe("2027-01-01");
  });

  it("never exceeds the 62-day database limit", () => {
    for (const anchor of ["2026-01-15", "2026-05-15", "2027-02-10"]) {
      const { from, to } = viewRange("month", anchor);
      expect(datesBetween(from, to).length).toBeLessThanOrEqual(42);
    }
  });
});
