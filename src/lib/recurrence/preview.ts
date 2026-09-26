import { z } from "zod";

import {
  addMonthsToLocalDate,
  compareLocalDates,
  formatTimeRange,
  isLocalDate,
  isLocalTime,
  localToUtc,
  minutesOfDay,
  type LocalDate,
  type LocalTime,
} from "@/lib/datetime";
import type { BusyBlock } from "@/lib/domain/availability";

import { expandRecurrenceDates, recurrenceEndBoundary } from "./dates";
import {
  MAX_RECURRENCE_MONTHS,
  MAX_RECURRENCE_OCCURRENCES,
  type MonthlyOrdinal,
  type RecurrenceInput,
  type RecurrenceRule,
} from "./types";

const localDateSchema = z.string().refine(isLocalDate, "Please choose a valid date.");
const localTimeSchema = z.string().refine(isLocalTime, "Please choose a valid time.");
const weekdaySchema = z.number().int().min(0).max(6);
const ordinalSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]);
const dailyIntervalSchema = z.number().int().min(1).max(365);
const weeklyIntervalSchema = z.number().int().min(1).max(52);
const monthlyIntervalSchema = z.number().int().min(1).max(12);
const dayOfMonthSchema = z.number().int().min(1).max(31);
const monthSchema = z.number().int().min(1).max(12);

export const recurrenceRuleSchema = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.literal("daily"), interval: dailyIntervalSchema }),
  z.object({ frequency: z.literal("weekdays") }),
  z.object({
    frequency: z.literal("weekly"),
    interval: weeklyIntervalSchema,
    weekdays: z.array(weekdaySchema).min(1).max(7).refine((days) => new Set(days).size === days.length, "Choose each weekday only once."),
  }),
  z.object({ frequency: z.literal("monthly_day"), interval: monthlyIntervalSchema, dayOfMonth: dayOfMonthSchema }),
  z.object({
    frequency: z.literal("monthly_nth_weekday"),
    interval: monthlyIntervalSchema,
    weekday: weekdaySchema,
    ordinals: z
      .array(ordinalSchema)
      .min(1, "Choose at least one week of the month.")
      .max(5)
      .refine((values) => new Set(values).size === values.length, "Choose each week of the month only once."),
  }),
  z.object({ frequency: z.literal("yearly_date"), month: monthSchema, dayOfMonth: dayOfMonthSchema }),
  z.object({
    frequency: z.literal("yearly_nth_weekday"),
    month: monthSchema,
    weekday: weekdaySchema,
    ordinal: ordinalSchema,
  }),
]);

export const recurrenceInputSchema = z
  .object({
    startDate: localDateSchema,
    endDate: localDateSchema.optional(),
    start: localTimeSchema,
    end: localTimeSchema,
    rule: recurrenceRuleSchema,
  })
  .superRefine((value, ctx) => {
    if (isLocalTime(value.start) && isLocalTime(value.end) && minutesOfDay(value.end) <= minutesOfDay(value.start)) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "The end time must be after the start time." });
    }
    if (!isLocalDate(value.startDate) || !value.endDate || !isLocalDate(value.endDate)) return;
    if (compareLocalDates(value.endDate, value.startDate) < 0) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date cannot be before the start date." });
    } else if (compareLocalDates(value.endDate, addMonthsToLocalDate(value.startDate, MAX_RECURRENCE_MONTHS)) > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "A recurring series may span at most 1 year.",
      });
    }
  });

export function parseRecurrenceInput(input: unknown): RecurrenceInput {
  return recurrenceInputSchema.parse(input) as RecurrenceInput;
}

export function recurrenceRuleFromStorage(value: {
  frequency: string;
  interval_count?: number | null;
  weekdays?: number[] | null;
  weekday?: number | null;
  month_ordinals?: number[] | null;
  month_ordinal?: number | null;
  day_of_month?: number | null;
  month_of_year?: number | null;
}): RecurrenceRule | null {
  let candidate: unknown;
  switch (value.frequency) {
    case "daily":
      candidate = { frequency: value.frequency, interval: value.interval_count };
      break;
    case "weekdays":
      candidate = { frequency: value.frequency };
      break;
    case "weekly":
      candidate = { frequency: value.frequency, interval: value.interval_count, weekdays: value.weekdays };
      break;
    case "monthly_day":
      candidate = { frequency: value.frequency, interval: value.interval_count, dayOfMonth: value.day_of_month };
      break;
    case "monthly_nth_weekday":
      candidate = {
        frequency: value.frequency,
        interval: value.interval_count,
        weekday: value.weekday,
        ordinals: value.month_ordinals ?? (value.month_ordinal == null ? null : [value.month_ordinal]),
      };
      break;
    case "yearly_date":
      candidate = { frequency: value.frequency, month: value.month_of_year, dayOfMonth: value.day_of_month };
      break;
    case "yearly_nth_weekday":
      candidate = {
        frequency: value.frequency,
        month: value.month_of_year,
        weekday: value.weekday,
        ordinal: value.month_ordinal,
      };
      break;
    default:
      return null;
  }
  const parsed = recurrenceRuleSchema.safeParse(candidate);
  return parsed.success ? (parsed.data as RecurrenceRule) : null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const ORDINAL_NAMES: Record<MonthlyOrdinal, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function intervalWords(value: number, singular: string, plural = `${singular}s`): string {
  return value === 1 ? `every ${singular}` : `every ${value} ${plural}`;
}

function listWords(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function recurrenceRuleLabel(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case "daily":
      return rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`;
    case "weekdays":
      return "Every weekday";
    case "weekly": {
      const days = rule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(", ");
      return `${intervalWords(rule.interval, "week").replace(/^every/, "Every")} on ${days}`;
    }
    case "monthly_day":
      return `Day ${rule.dayOfMonth} of ${intervalWords(rule.interval, "month")}`;
    case "monthly_nth_weekday":
      return `The ${listWords(rule.ordinals.map((ordinal) => ORDINAL_NAMES[ordinal]))} ${WEEKDAY_NAMES[rule.weekday]}${rule.ordinals.length === 1 ? "" : "s"} of ${intervalWords(rule.interval, "month")}`;
    case "yearly_date":
      return `Every ${MONTH_NAMES[rule.month - 1]} ${rule.dayOfMonth}`;
    case "yearly_nth_weekday":
      return `The ${ORDINAL_NAMES[rule.ordinal]} ${WEEKDAY_NAMES[rule.weekday]} of ${MONTH_NAMES[rule.month - 1]}`;
  }
}

export function recurrenceScheduleLabel(input: RecurrenceInput): string {
  return `${recurrenceRuleLabel(input.rule)}, ${formatTimeRange(input.start, input.end)}`;
}

export type RecurrencePreviewStatus = "available" | "conflict" | "invalid_local_time";

export type RecurrencePreviewOccurrence = {
  date: LocalDate;
  start: LocalTime;
  end: LocalTime;
  startAt: string | null;
  endAt: string | null;
  status: RecurrencePreviewStatus;
  conflictingBlocks: BusyBlock[];
};

export type RecurrenceConflictGroup = {
  date: LocalDate;
  occurrence: RecurrencePreviewOccurrence;
  conflictingBlocks: BusyBlock[];
};

export type RecurrencePreview = {
  label: string;
  seriesStartDate: LocalDate;
  seriesEndDate: LocalDate;
  seriesEndIsAutomatic: boolean;
  occurrences: RecurrencePreviewOccurrence[];
  conflicts: RecurrenceConflictGroup[];
  invalidLocalTimeDates: LocalDate[];
  continuesAfterPreview: boolean;
};

export type BuildRecurrencePreviewOptions = {
  /** Inclusive rolling preview/materialization boundary. */
  throughDate: LocalDate;
  timeZone: string;
  busyBlocks?: readonly BusyBlock[];
  maxOccurrences?: number;
};

function overlaps(startAt: Date, endAt: Date, block: BusyBlock): boolean {
  const blockStart = new Date(block.start_at);
  const blockEnd = new Date(block.end_at);
  return (
    !Number.isNaN(blockStart.getTime()) &&
    !Number.isNaN(blockEnd.getTime()) &&
    startAt.getTime() < blockEnd.getTime() &&
    blockStart.getTime() < endAt.getTime()
  );
}

export function groupRecurrenceConflicts(
  occurrences: readonly RecurrencePreviewOccurrence[],
): RecurrenceConflictGroup[] {
  return occurrences
    .filter((occurrence) => occurrence.status === "conflict")
    .map((occurrence) => ({
      date: occurrence.date,
      occurrence,
      conflictingBlocks: occurrence.conflictingBlocks,
    }));
}

/** Builds a reusable preview after validation; it never writes reservations. */
export function buildRecurrencePreview(
  candidate: unknown,
  options: BuildRecurrencePreviewOptions,
): RecurrencePreview {
  const input = parseRecurrenceInput(candidate);
  if (!isLocalDate(options.throughDate)) throw new RangeError("Please choose a valid preview end date.");

  const dates = expandRecurrenceDates(input, {
    throughDate: options.throughDate,
    maxOccurrences: options.maxOccurrences,
  });
  const busyBlocks = options.busyBlocks ?? [];
  const seriesEndDate = recurrenceEndBoundary(
    input,
    addMonthsToLocalDate(input.startDate, MAX_RECURRENCE_MONTHS),
  );
  const occurrences = dates.map<RecurrencePreviewOccurrence>((date) => {
    const startAt = localToUtc(date, input.start, options.timeZone);
    const endAt = localToUtc(date, input.end, options.timeZone);
    if (!startAt || !endAt) {
      return {
        date,
        start: input.start,
        end: input.end,
        startAt: null,
        endAt: null,
        status: "invalid_local_time",
        conflictingBlocks: [],
      };
    }

    const conflictingBlocks = busyBlocks.filter((block) => overlaps(startAt, endAt, block));
    return {
      date,
      start: input.start,
      end: input.end,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      status: conflictingBlocks.length ? "conflict" : "available",
      conflictingBlocks: [...conflictingBlocks],
    };
  });

  return {
    label: recurrenceScheduleLabel(input),
    seriesStartDate: input.startDate,
    seriesEndDate,
    seriesEndIsAutomatic: !input.endDate,
    occurrences,
    conflicts: groupRecurrenceConflicts(occurrences),
    invalidLocalTimeDates: occurrences
      .filter((occurrence) => occurrence.status === "invalid_local_time")
      .map((occurrence) => occurrence.date),
    continuesAfterPreview:
      compareLocalDates(options.throughDate, seriesEndDate) < 0 ||
      (dates.length === (options.maxOccurrences ?? MAX_RECURRENCE_OCCURRENCES) &&
        compareLocalDates(dates.at(-1) ?? input.startDate, recurrenceEndBoundary(input, options.throughDate)) < 0),
  };
}
