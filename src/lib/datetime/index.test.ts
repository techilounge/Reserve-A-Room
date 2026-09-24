import { describe, expect, it } from "vitest";

import {
  addDaysToLocalDate,
  formatLongDate,
  formatTime,
  formatTimeRange,
  isLocalDate,
  localToUtc,
  timeFromMinutes,
  minutesOfDay,
  toLocalParts,
  todayInZone,
} from "./index";

const TZ = "America/Chicago";

describe("todayInZone", () => {
  it("uses the church's calendar date, not UTC's", () => {
    // 2026-10-02 03:30 UTC is still Oct 1 in Chicago (CDT, UTC-5).
    expect(todayInZone(TZ, new Date("2026-10-02T03:30:00Z"))).toBe("2026-10-01");
    expect(todayInZone("UTC", new Date("2026-10-02T03:30:00Z"))).toBe("2026-10-02");
  });
});

describe("localToUtc", () => {
  it("converts CDT and CST wall-clock times correctly", () => {
    expect(localToUtc("2026-10-01", "09:00", TZ)?.toISOString()).toBe("2026-10-01T14:00:00.000Z");
    expect(localToUtc("2026-12-01", "09:00", TZ)?.toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });

  it("handles the days DST changes", () => {
    // Spring forward: Mar 8 2026. 9:00 AM is CDT (UTC-5).
    expect(localToUtc("2026-03-08", "09:00", TZ)?.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    // Fall back: Nov 1 2026. 9:00 AM is CST (UTC-6).
    expect(localToUtc("2026-11-01", "09:00", TZ)?.toISOString()).toBe("2026-11-01T15:00:00.000Z");
  });

  it("rejects a time that doesn't exist instead of silently moving it", () => {
    expect(localToUtc("2026-03-08", "02:30", TZ)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(localToUtc("2026-02-30", "09:00", TZ)).toBeNull();
    expect(localToUtc("2026-10-01", "9:00", TZ)).toBeNull();
    expect(localToUtc("2026-10-01", "24:00", TZ)).toBeNull();
  });

  it("round-trips through toLocalParts", () => {
    const instant = localToUtc("2026-07-04", "18:30", TZ)!;
    expect(toLocalParts(instant, TZ)).toEqual({ date: "2026-07-04", time: "18:30" });
  });
});

describe("local date helpers", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDaysToLocalDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToLocalDate("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDaysToLocalDate("2026-10-01", 28)).toBe("2026-10-29");
  });

  it("validates dates", () => {
    expect(isLocalDate("2026-10-01")).toBe(true);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("10/01/2026")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats dates and 12-hour times", () => {
    expect(formatLongDate("2026-10-01")).toBe("Thursday, October 1, 2026");
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("09:05")).toBe("9:05 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("21:30")).toBe("9:30 PM");
    expect(formatTimeRange("09:00", "10:30")).toBe("9:00 AM – 10:30 AM");
  });

  it("converts minutes of day", () => {
    expect(minutesOfDay("06:30")).toBe(390);
    expect(timeFromMinutes(390)).toBe("06:30");
    expect(timeFromMinutes(1320)).toBe("22:00");
  });
});
