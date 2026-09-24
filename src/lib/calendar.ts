import { addDaysToLocalDate, addMonthsToLocalDate, localDateToUtcMidnight, type LocalDate } from "@/lib/datetime";

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** 0 = Sunday … 6 = Saturday for a local date. */
export function dayOfWeek(date: LocalDate): number {
  return localDateToUtcMidnight(date).getUTCDay();
}

export function startOfWeek(date: LocalDate): LocalDate {
  return addDaysToLocalDate(date, -dayOfWeek(date));
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

/** Inclusive date range shown by a view (month views pad to whole weeks). */
export function viewRange(view: CalendarView, anchor: LocalDate): { from: LocalDate; to: LocalDate } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDaysToLocalDate(from, 6) };
  }
  const first = startOfMonth(anchor);
  const last = addDaysToLocalDate(addMonthsToLocalDate(first, 1), -1);
  return { from: startOfWeek(first), to: addDaysToLocalDate(startOfWeek(last), 6) };
}

/** Anchor for the previous/next period. */
export function shiftAnchor(view: CalendarView, anchor: LocalDate, direction: -1 | 1): LocalDate {
  if (view === "day") return addDaysToLocalDate(anchor, direction);
  if (view === "week") return addDaysToLocalDate(anchor, 7 * direction);
  return addMonthsToLocalDate(startOfMonth(anchor), direction);
}

export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let d = from; d <= to; d = addDaysToLocalDate(d, 1)) dates.push(d);
  return dates;
}
