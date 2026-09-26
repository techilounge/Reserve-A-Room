import {
  addDaysToLocalDate,
  addMonthsToLocalDate,
  compareLocalDates,
  isLocalDate,
  localDateToUtcMidnight,
  utcMidnightToLocalDate,
  type LocalDate,
} from "@/lib/datetime";

import {
  MAX_RECURRENCE_MONTHS,
  MAX_RECURRENCE_OCCURRENCES,
  type MonthlyOrdinal,
  type RecurrenceExpansionOptions,
  type RecurrenceInput,
  type Weekday,
} from "./types";

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): Weekday {
  return localDateToUtcMidnight(date).getUTCDay() as Weekday;
}

/** The requested weekday on or after `date`. */
export function weekdayOnOrAfter(date: LocalDate, weekday: Weekday): LocalDate {
  return addDaysToLocalDate(date, (weekday - weekdayOf(date) + 7) % 7);
}

/** Finds an ordinal weekday in the month containing `date`; `-1` means the final one. */
export function nthWeekdayOfMonth(
  date: LocalDate,
  weekday: Weekday,
  ordinal: MonthlyOrdinal,
): LocalDate | null {
  const first = `${date.slice(0, 7)}-01`;
  if (ordinal === -1) {
    const last = addDaysToLocalDate(addMonthsToLocalDate(first, 1), -1);
    return addDaysToLocalDate(last, -((weekdayOf(last) - weekday + 7) % 7));
  }
  const candidate = addDaysToLocalDate(weekdayOnOrAfter(first, weekday), (ordinal - 1) * 7);
  return candidate.slice(0, 7) === first.slice(0, 7) ? candidate : null;
}

function exactCalendarDate(year: number, month: number, day: number): LocalDate | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return utcMidnightToLocalDate(value);
}

function monthParts(date: LocalDate, monthOffset = 0): { year: number; month: number } {
  const [year, month] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
}

function daysBetween(start: LocalDate, end: LocalDate): number {
  return Math.round((localDateToUtcMidnight(end).getTime() - localDateToUtcMidnight(start).getTime()) / 86_400_000);
}

function assertExpansionBoundary(value: string): asserts value is LocalDate {
  if (!isLocalDate(value)) throw new RangeError("A valid through date is required to expand a recurring series.");
}

export function recurrenceEndBoundary(input: RecurrenceInput, throughDate: LocalDate): LocalDate {
  let end = addMonthsToLocalDate(input.startDate, MAX_RECURRENCE_MONTHS);
  if (input.endDate && compareLocalDates(input.endDate, end) < 0) end = input.endDate;
  return compareLocalDates(throughDate, end) < 0 ? throughDate : end;
}

function candidateDates(input: RecurrenceInput, effectiveEnd: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  const add = (date: LocalDate | null) => {
    if (date && compareLocalDates(date, input.startDate) >= 0 && compareLocalDates(date, effectiveEnd) <= 0) dates.push(date);
  };

  switch (input.rule.frequency) {
    case "daily":
      for (let date = input.startDate; compareLocalDates(date, effectiveEnd) <= 0; date = addDaysToLocalDate(date, input.rule.interval)) add(date);
      break;
    case "weekdays":
      for (let date = input.startDate; compareLocalDates(date, effectiveEnd) <= 0; date = addDaysToLocalDate(date, 1)) {
        const weekday = weekdayOf(date);
        if (weekday >= 1 && weekday <= 5) add(date);
      }
      break;
    case "weekly": {
      const anchorWeekStart = addDaysToLocalDate(input.startDate, -weekdayOf(input.startDate));
      const selected = new Set(input.rule.weekdays);
      for (let date = input.startDate; compareLocalDates(date, effectiveEnd) <= 0; date = addDaysToLocalDate(date, 1)) {
        const weekIndex = Math.floor(daysBetween(anchorWeekStart, date) / 7);
        if (weekIndex % input.rule.interval === 0 && selected.has(weekdayOf(date))) add(date);
      }
      break;
    }
    case "monthly_day":
      for (let offset = 0; ; offset += input.rule.interval) {
        const { year, month } = monthParts(input.startDate, offset);
        const monthStart = exactCalendarDate(year, month, 1)!;
        if (compareLocalDates(monthStart, effectiveEnd) > 0) break;
        add(exactCalendarDate(year, month, input.rule.dayOfMonth));
      }
      break;
    case "monthly_nth_weekday":
      for (let offset = 0; ; offset += input.rule.interval) {
        const { year, month } = monthParts(input.startDate, offset);
        const monthStart = exactCalendarDate(year, month, 1)!;
        if (compareLocalDates(monthStart, effectiveEnd) > 0) break;
        for (const ordinal of input.rule.ordinals) {
          add(nthWeekdayOfMonth(monthStart, input.rule.weekday, ordinal));
        }
      }
      break;
    case "yearly_date": {
      const startYear = Number(input.startDate.slice(0, 4));
      const endYear = Number(effectiveEnd.slice(0, 4));
      for (let year = startYear; year <= endYear; year += 1) add(exactCalendarDate(year, input.rule.month, input.rule.dayOfMonth));
      break;
    }
    case "yearly_nth_weekday": {
      const startYear = Number(input.startDate.slice(0, 4));
      const endYear = Number(effectiveEnd.slice(0, 4));
      for (let year = startYear; year <= endYear; year += 1) {
        add(nthWeekdayOfMonth(exactCalendarDate(year, input.rule.month, 1)!, input.rule.weekday, input.rule.ordinal));
      }
      break;
    }
  }
  return [...new Set(dates)].sort(compareLocalDates);
}

/**
 * Expands a rule into local calendar dates. Boundaries are inclusive. Expansion stops
 * at the earlier of the requested boundary, one calendar year, or the instance cap.
 */
export function expandRecurrenceDates(input: RecurrenceInput, options: RecurrenceExpansionOptions): LocalDate[] {
  assertExpansionBoundary(options.throughDate);
  const limit = options.maxOccurrences ?? MAX_RECURRENCE_OCCURRENCES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECURRENCE_OCCURRENCES) {
    throw new RangeError(`maxOccurrences must be between 1 and ${MAX_RECURRENCE_OCCURRENCES}.`);
  }
  const effectiveEnd = recurrenceEndBoundary(input, options.throughDate);
  if (compareLocalDates(effectiveEnd, input.startDate) < 0) return [];
  return candidateDates(input, effectiveEnd).slice(0, limit);
}
