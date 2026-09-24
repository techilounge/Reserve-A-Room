import { describe, expect, it } from "vitest";

import { localToUtc } from "@/lib/datetime";

import {
  availableEndTimes,
  availableStartTimes,
  busyRanges,
  daySegments,
  earliestStartMinute,
  isRangeAvailable,
  type BusyBlock,
  type DayWindow,
} from "./availability";

const TZ = "America/Chicago";
const window: DayWindow = {
  date: "2026-10-15",
  timeZone: TZ,
  dayStart: "06:00",
  dayEnd: "22:00",
  intervalMinutes: 30,
  leadMinutes: 0,
};
const block = (date: string, from: string, to: string): BusyBlock => ({
  start_at: localToUtc(date, from, TZ)!.toISOString(),
  end_at: localToUtc(date, to, TZ)!.toISOString(),
});
// "Now" is well before the window's date unless a test says otherwise.
const EARLIER = new Date("2026-10-01T15:00:00Z");

describe("busyRanges", () => {
  it("merges overlapping and touching blocks and ignores other days", () => {
    const ranges = busyRanges(window, [
      block("2026-10-15", "09:00", "10:00"),
      block("2026-10-15", "10:00", "11:00"),
      block("2026-10-15", "10:30", "12:00"),
      block("2026-10-16", "09:00", "10:00"),
    ]);
    expect(ranges).toEqual([[540, 720]]);
  });
});

describe("daySegments", () => {
  it("shows unavailable time without any details about who reserved it", () => {
    const segments = daySegments(window, [block("2026-10-15", "09:00", "10:30")], EARLIER);
    expect(segments).toEqual([
      { start: "06:00", end: "09:00", state: "available" },
      { start: "09:00", end: "10:30", state: "unavailable" },
      { start: "10:30", end: "22:00", state: "available" },
    ]);
  });

  it("marks elapsed time as past on the current day", () => {
    // 10:10 AM CDT on Oct 15 → next bookable start is 10:30.
    const now = new Date("2026-10-15T15:10:00Z");
    const segments = daySegments(window, [], now);
    expect(segments[0]).toEqual({ start: "06:00", end: "10:30", state: "past" });
    expect(segments[1]).toEqual({ start: "10:30", end: "22:00", state: "available" });
  });

  it("treats a past day as entirely past", () => {
    const now = new Date("2026-10-20T15:00:00Z");
    expect(daySegments(window, [], now)).toEqual([{ start: "06:00", end: "22:00", state: "past" }]);
  });
});

describe("earliestStartMinute", () => {
  it("applies the lead time and rounds up to the interval", () => {
    const now = new Date("2026-10-15T15:00:00Z"); // 10:00 AM CDT exactly
    expect(earliestStartMinute(window, now)).toBe(630); // 10:30 (strictly after now)
    expect(earliestStartMinute({ ...window, leadMinutes: 60 }, now)).toBe(690); // 11:30
  });
});

describe("start and end choices", () => {
  const busy = [block("2026-10-15", "09:00", "10:00"), block("2026-10-15", "13:00", "14:00")];

  it("offers only free start times", () => {
    const starts = availableStartTimes(window, busy, EARLIER);
    expect(starts).toContain("08:30");
    expect(starts).not.toContain("09:00");
    expect(starts).not.toContain("09:30");
    expect(starts).toContain("10:00");
    expect(starts.at(-1)).toBe("21:30");
  });

  it("offers end times up to the next reservation (back-to-back allowed)", () => {
    expect(availableEndTimes(window, busy, "11:00")).toEqual(["11:30", "12:00", "12:30", "13:00"]);
    expect(availableEndTimes(window, busy, "21:00")).toEqual(["21:30", "22:00"]);
  });

  it("validates a full range", () => {
    expect(isRangeAvailable(window, busy, "10:00", "13:00", EARLIER)).toBe(true);
    expect(isRangeAvailable(window, busy, "10:00", "13:30", EARLIER)).toBe(false);
    expect(isRangeAvailable(window, busy, "10:15", "11:00", EARLIER)).toBe(false);
    expect(isRangeAvailable(window, busy, "21:00", "22:30", EARLIER)).toBe(false);
    expect(isRangeAvailable(window, busy, "05:30", "07:00", EARLIER)).toBe(false);
  });
});
