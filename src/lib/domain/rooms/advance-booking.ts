import {
  addDaysToLocalDate,
  addMonthsToLocalDate,
  compareLocalDates,
  formatLongDate,
  type LocalDate,
} from "@/lib/datetime";

/**
 * Maximum advance reservation (ADR-3). Mirrors private.add_advance() in SQL — both are
 * covered by the same fixtures (supabase/tests/parity.test.ts). The database trigger is
 * the final authority; this exists so the UI can disable dates and explain the rule.
 */

export const ADVANCE_UNITS = ["day", "week", "month"] as const;
export type AdvanceUnit = (typeof ADVANCE_UNITS)[number];

export type AdvanceRule = { value: number; unit: AdvanceUnit };

/** Upper bounds (≈ two years), identical to private.is_valid_advance(). */
export const ADVANCE_MAX: Record<AdvanceUnit, number> = { day: 730, week: 104, month: 24 };

export function isValidAdvanceRule(rule: AdvanceRule): boolean {
  return Number.isInteger(rule.value) && rule.value >= 1 && rule.value <= ADVANCE_MAX[rule.unit];
}

type RoomAdvanceFields = {
  max_advance_value: number | null;
  max_advance_unit: AdvanceUnit | null;
};

type SettingsAdvanceFields = {
  default_max_advance_value: number;
  default_max_advance_unit: AdvanceUnit;
};

/** The room's own rule, or the application default when the room has none. */
export function effectiveAdvanceRule(room: RoomAdvanceFields, settings: SettingsAdvanceFields): AdvanceRule {
  if (room.max_advance_value !== null && room.max_advance_unit !== null) {
    return { value: room.max_advance_value, unit: room.max_advance_unit };
  }
  return { value: settings.default_max_advance_value, unit: settings.default_max_advance_unit };
}

/** Last local date on which a reservation may start (inclusive). */
export function horizonDate(today: LocalDate, rule: AdvanceRule): LocalDate {
  switch (rule.unit) {
    case "day":
      return addDaysToLocalDate(today, rule.value);
    case "week":
      return addDaysToLocalDate(today, rule.value * 7);
    case "month":
      return addMonthsToLocalDate(today, rule.value);
  }
}

export function isWithinHorizon(date: LocalDate, today: LocalDate, rule: AdvanceRule): boolean {
  return compareLocalDates(date, today) >= 0 && compareLocalDates(date, horizonDate(today, rule)) <= 0;
}

/** "4 weeks", "1 month", "10 days" */
export function advanceLabel(rule: AdvanceRule): string {
  return `${rule.value} ${rule.unit}${rule.value === 1 ? "" : "s"}`;
}

/** "This room may only be reserved up to 4 weeks in advance." */
export function advanceLimitMessage(rule: AdvanceRule): string {
  return `This room may only be reserved up to ${advanceLabel(rule)} in advance.`;
}

/** "Reservations are open through Thursday, October 29, 2026." */
export function horizonMessage(today: LocalDate, rule: AdvanceRule): string {
  return `Reservations are open through ${formatLongDate(horizonDate(today, rule))}.`;
}
