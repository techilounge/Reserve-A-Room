import { describe, expect, it } from "vitest";

import { calendarInstantToLocal, calendarLocalToInstant } from "./datetime";

describe("church calendar configured timezone", () => {
  it("stores and displays wall-clock values in a non-Chicago timezone", () => {
    const instant = calendarLocalToInstant("2027-01-15T08:30", "America/New_York");
    expect(instant).toBe("2027-01-15T13:30:00.000Z");
    expect(calendarInstantToLocal(instant!, "America/New_York")).toBe("2027-01-15T08:30");
    expect(calendarInstantToLocal(instant!, "America/Chicago")).toBe("2027-01-15T07:30");
  });

  it("rejects nonexistent spring-forward times in the selected timezone", () => {
    expect(calendarLocalToInstant("2027-03-14T02:30", "America/New_York")).toBeUndefined();
  });
});
