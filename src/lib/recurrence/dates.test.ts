import { describe, expect, it } from "vitest";

import { expandRecurrenceDates, nthWeekdayOfMonth } from "./dates";
import type { RecurrenceInput } from "./types";

const schedule = (input: Partial<RecurrenceInput> = {}): RecurrenceInput => ({
  startDate: "2026-10-01",
  start: "14:00",
  end: "15:00",
  rule: { frequency: "weekly", interval: 1, weekdays: [6] },
  ...input,
});

describe("daily recurrence dates", () => {
  it("supports every X days and treats an explicit end as inclusive", () => {
    expect(
      expandRecurrenceDates(
        schedule({ endDate: "2026-10-07", rule: { frequency: "daily", interval: 2 } }),
        { throughDate: "2026-12-31" },
      ),
    ).toEqual(["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-07"]);
  });

  it("expands weekdays while excluding Saturday and Sunday", () => {
    expect(
      expandRecurrenceDates(schedule({ rule: { frequency: "weekdays" } }), { throughDate: "2026-10-07" }),
    ).toEqual(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]);
  });
});

describe("weekly recurrence dates", () => {
  it("anchors multi-day schedules to every X weeks", () => {
    const input = schedule({
      startDate: "2026-09-30",
      rule: { frequency: "weekly", interval: 2, weekdays: [1, 3] },
    });
    expect(expandRecurrenceDates(input, { throughDate: "2026-10-31" })).toEqual([
      "2026-09-30",
      "2026-10-12",
      "2026-10-14",
      "2026-10-26",
      "2026-10-28",
    ]);
  });

  it("includes a selected start date", () => {
    expect(
      expandRecurrenceDates(schedule({ startDate: "2026-10-03" }), { throughDate: "2026-10-03" }),
    ).toEqual(["2026-10-03"]);
  });
});

describe("monthly recurrence dates", () => {
  it("supports a calendar day every X months and skips impossible dates", () => {
    const input = schedule({
      startDate: "2026-01-01",
      rule: { frequency: "monthly_day", interval: 1, dayOfMonth: 31 },
    });
    expect(expandRecurrenceDates(input, { throughDate: "2026-05-31" })).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("finds first, second, fourth, and last Saturdays", () => {
    expect(nthWeekdayOfMonth("2026-10-20", 6, 1)).toBe("2026-10-03");
    expect(nthWeekdayOfMonth("2026-10-20", 6, 2)).toBe("2026-10-10");
    expect(nthWeekdayOfMonth("2026-10-20", 6, 4)).toBe("2026-10-24");
    expect(nthWeekdayOfMonth("2026-10-20", 6, -1)).toBe("2026-10-31");
  });

  it("supports ordinal weekdays every X months", () => {
    const input = schedule({
      startDate: "2026-01-01",
      rule: { frequency: "monthly_nth_weekday", interval: 2, weekday: 6, ordinals: [-1] },
    });
    expect(expandRecurrenceDates(input, { throughDate: "2026-06-30" })).toEqual([
      "2026-01-31",
      "2026-03-28",
      "2026-05-30",
    ]);
  });

  it("supports multiple weeks of the month without duplicating a fourth-and-last match", () => {
    expect(
      expandRecurrenceDates(
        schedule({
          startDate: "2026-10-01",
          rule: { frequency: "monthly_nth_weekday", interval: 1, weekday: 6, ordinals: [2, 4] },
        }),
        { throughDate: "2026-11-30" },
      ),
    ).toEqual(["2026-10-10", "2026-10-24", "2026-11-14", "2026-11-28"]);

    expect(
      expandRecurrenceDates(
        schedule({
          startDate: "2027-02-01",
          rule: { frequency: "monthly_nth_weekday", interval: 1, weekday: 6, ordinals: [4, -1] },
        }),
        { throughDate: "2027-02-28" },
      ),
    ).toEqual(["2027-02-27"]);
  });
});

describe("yearly recurrence dates", () => {
  it("supports a fixed month/day and skips February 29 in a non-leap year", () => {
    const input = schedule({
      startDate: "2027-01-01",
      rule: { frequency: "yearly_date", month: 2, dayOfMonth: 29 },
    });
    expect(expandRecurrenceDates(input, { throughDate: "2028-01-01" })).toEqual([]);
  });

  it("supports an ordinal weekday of a month", () => {
    const input = schedule({
      startDate: "2026-01-01",
      rule: { frequency: "yearly_nth_weekday", month: 11, weekday: 4, ordinal: 4 },
    });
    expect(expandRecurrenceDates(input, { throughDate: "2027-01-01" })).toEqual(["2026-11-26"]);
  });
});

describe("expansion guardrails", () => {
  it("stops at the earlier of one year or 50 instances", () => {
    const dates = expandRecurrenceDates(
      schedule({ startDate: "2026-01-01", rule: { frequency: "daily", interval: 1 } }),
      { throughDate: "2030-01-01" },
    );
    expect(dates).toHaveLength(50);
    expect(dates.at(-1)).toBe("2026-02-19");

    expect(
      expandRecurrenceDates(
        schedule({ startDate: "2026-01-01", rule: { frequency: "monthly_day", interval: 1, dayOfMonth: 1 } }),
        { throughDate: "2030-01-01" },
      ).at(-1),
    ).toBe("2027-01-01");
  });

  it("honors a smaller caller-provided instance cap", () => {
    expect(
      expandRecurrenceDates(schedule({ rule: { frequency: "daily", interval: 1 } }), {
        throughDate: "2026-10-31",
        maxOccurrences: 3,
      }),
    ).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });
});
