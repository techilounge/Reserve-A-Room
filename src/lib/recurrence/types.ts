import type { LocalDate, LocalTime } from "@/lib/datetime";

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MONTHLY_ORDINALS = [1, 2, 3, 4, -1] as const;
export type MonthlyOrdinal = (typeof MONTHLY_ORDINALS)[number];

export type RecurrenceRule =
  | { frequency: "daily"; interval: number }
  | { frequency: "weekdays" }
  | { frequency: "weekly"; interval: number; weekdays: Weekday[] }
  | { frequency: "monthly_day"; interval: number; dayOfMonth: number }
  | { frequency: "monthly_nth_weekday"; interval: number; weekday: Weekday; ordinals: MonthlyOrdinal[] }
  | { frequency: "yearly_date"; month: number; dayOfMonth: number }
  | { frequency: "yearly_nth_weekday"; month: number; weekday: Weekday; ordinal: MonthlyOrdinal };

/**
 * A recurrence stays in church-local wall-clock time until a server action creates
 * reservation rows. This prevents UTC offset changes from moving a series by an hour.
 */
export type RecurrenceInput = {
  startDate: LocalDate;
  endDate?: LocalDate;
  start: LocalTime;
  end: LocalTime;
  rule: RecurrenceRule;
};

/** Product guardrails for one series. The earlier limit always wins. */
export const MAX_RECURRENCE_MONTHS = 12;
export const MAX_RECURRENCE_OCCURRENCES = 50;

export type RecurrenceExpansionOptions = {
  /** Inclusive preview/materialization boundary. Required so ongoing series are finite. */
  throughDate: LocalDate;
  maxOccurrences?: number;
};
