import { describe, expect, it } from "vitest";

import { localToUtc } from "@/lib/datetime";
import type { BusyBlock } from "@/lib/domain/availability";

import {
  buildRecurrencePreview,
  parseRecurrenceInput,
  recurrenceInputSchema,
  recurrenceRuleLabel,
} from "./preview";
import type { RecurrenceInput } from "./types";

const TZ = "America/Chicago";
const valid: RecurrenceInput = {
  startDate: "2026-10-01",
  start: "14:00",
  end: "15:00",
  rule: { frequency: "weekly", interval: 1, weekdays: [6] },
};

const block = (date: string, start: string, end: string): BusyBlock => ({
  start_at: localToUtc(date, start, TZ)!.toISOString(),
  end_at: localToUtc(date, end, TZ)!.toISOString(),
});

describe("recurrence validation and labels", () => {
  it("accepts ongoing and bounded schedules", () => {
    expect(parseRecurrenceInput(valid)).toEqual(valid);
    expect(parseRecurrenceInput({ ...valid, endDate: "2027-10-01" }).endDate).toBe("2027-10-01");
  });

  it("rejects invalid ranges, duplicate weekly days, and explicit series longer than one year", () => {
    expect(recurrenceInputSchema.safeParse({ ...valid, end: "13:30" }).success).toBe(false);
    expect(recurrenceInputSchema.safeParse({ ...valid, endDate: "2026-09-30" }).success).toBe(false);
    expect(recurrenceInputSchema.safeParse({ ...valid, endDate: "2027-10-02" }).success).toBe(false);
    expect(
      recurrenceInputSchema.safeParse({
        ...valid,
        rule: { frequency: "weekly", interval: 1, weekdays: [1, 1] },
      }).success,
    ).toBe(false);
  });

  it("describes each supported rule family", () => {
    expect(recurrenceRuleLabel({ frequency: "daily", interval: 2 })).toBe("Every 2 days");
    expect(recurrenceRuleLabel({ frequency: "weekdays" })).toBe("Every weekday");
    expect(recurrenceRuleLabel({ frequency: "weekly", interval: 2, weekdays: [1, 3] })).toBe(
      "Every 2 weeks on Monday, Wednesday",
    );
    expect(recurrenceRuleLabel({ frequency: "monthly_day", interval: 3, dayOfMonth: 15 })).toBe(
      "Day 15 of every 3 months",
    );
    expect(
      recurrenceRuleLabel({ frequency: "monthly_nth_weekday", interval: 1, weekday: 5, ordinals: [-1] }),
    ).toBe("The last Friday of every month");
    expect(
      recurrenceRuleLabel({ frequency: "monthly_nth_weekday", interval: 1, weekday: 6, ordinals: [2, 4] }),
    ).toBe("The second and fourth Saturdays of every month");
    expect(recurrenceRuleLabel({ frequency: "yearly_date", month: 12, dayOfMonth: 25 })).toBe(
      "Every December 25",
    );
    expect(recurrenceRuleLabel({ frequency: "yearly_nth_weekday", month: 11, weekday: 4, ordinal: 4 })).toBe(
      "The fourth Thursday of November",
    );
  });
});

describe("recurrence preview", () => {
  it("uses a finite rolling horizon for an ongoing series", () => {
    const preview = buildRecurrencePreview(valid, { throughDate: "2026-10-17", timeZone: TZ });
    expect(preview.occurrences.map(({ date }) => date)).toEqual(["2026-10-03", "2026-10-10", "2026-10-17"]);
    expect(preview.continuesAfterPreview).toBe(true);
    expect(preview.label).toBe("Every week on Saturday, 2:00 PM – 3:00 PM");
    expect(preview.seriesStartDate).toBe("2026-10-01");
    expect(preview.seriesEndDate).toBe("2027-10-01");
    expect(preview.seriesEndIsAutomatic).toBe(true);
  });

  it("preserves wall-clock time across DST and reports a spring-forward gap", () => {
    const preview = buildRecurrencePreview(
      {
        startDate: "2026-03-01",
        start: "02:30",
        end: "03:30",
        rule: { frequency: "weekly", interval: 1, weekdays: [0] },
      },
      { throughDate: "2026-03-15", timeZone: TZ },
    );

    expect(preview.occurrences.map(({ date, start, status }) => ({ date, start, status }))).toEqual([
      { date: "2026-03-01", start: "02:30", status: "available" },
      { date: "2026-03-08", start: "02:30", status: "invalid_local_time" },
      { date: "2026-03-15", start: "02:30", status: "available" },
    ]);
    expect(preview.invalidLocalTimeDates).toEqual(["2026-03-08"]);
    expect(preview.occurrences[0].startAt).toBe("2026-03-01T08:30:00.000Z");
    expect(preview.occurrences[2].startAt).toBe("2026-03-15T07:30:00.000Z");
  });

  it("groups overlapping busy blocks by occurrence and permits adjacent ranges", () => {
    const preview = buildRecurrencePreview(valid, {
      throughDate: "2026-10-17",
      timeZone: TZ,
      busyBlocks: [
        block("2026-10-03", "13:00", "14:00"),
        block("2026-10-10", "14:30", "15:30"),
        block("2026-10-10", "14:45", "16:00"),
      ],
    });

    expect(preview.occurrences.map(({ status }) => status)).toEqual(["available", "conflict", "available"]);
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0]).toMatchObject({ date: "2026-10-10" });
    expect(preview.conflicts[0].conflictingBlocks).toHaveLength(2);
  });

  it("stops after a bounded series ends", () => {
    const preview = buildRecurrencePreview(
      { ...valid, endDate: "2026-10-10" },
      { throughDate: "2026-12-31", timeZone: TZ },
    );
    expect(preview.occurrences.map(({ date }) => date)).toEqual(["2026-10-03", "2026-10-10"]);
    expect(preview.continuesAfterPreview).toBe(false);
    expect(preview.seriesStartDate).toBe("2026-10-01");
    expect(preview.seriesEndDate).toBe("2026-10-10");
    expect(preview.seriesEndIsAutomatic).toBe(false);
  });
});
