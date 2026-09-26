import { startOfMonth } from "@/lib/calendar";
import { addDaysToLocalDate, isLocalDate, localToUtc, todayInZone, type LocalDate } from "@/lib/datetime";

export const AUDIT_DATE_PRESETS = ["all", "today", "last_7_days", "last_30_days", "this_month", "custom"] as const;
export type AuditDatePreset = (typeof AUDIT_DATE_PRESETS)[number];

export function normalizeAuditDatePreset(value: unknown): AuditDatePreset {
  return typeof value === "string" && AUDIT_DATE_PRESETS.includes(value as AuditDatePreset)
    ? (value as AuditDatePreset)
    : "all";
}

export function resolveAuditDateRange(input: {
  preset: AuditDatePreset;
  from?: string;
  to?: string;
  timeZone: string;
  now?: Date;
}): { from?: LocalDate; to?: LocalDate; fromInstant?: string; toExclusiveInstant?: string; error?: string } {
  const today = todayInZone(input.timeZone, input.now);
  let from: LocalDate | undefined;
  let to: LocalDate | undefined;

  if (input.preset === "today") from = to = today;
  if (input.preset === "last_7_days") {
    from = addDaysToLocalDate(today, -6);
    to = today;
  }
  if (input.preset === "last_30_days") {
    from = addDaysToLocalDate(today, -29);
    to = today;
  }
  if (input.preset === "this_month") {
    from = startOfMonth(today);
    to = today;
  }
  if (input.preset === "custom") {
    from = input.from && isLocalDate(input.from) ? input.from : undefined;
    to = input.to && isLocalDate(input.to) ? input.to : undefined;
    if ((input.from && !from) || (input.to && !to)) return { error: "Choose valid custom dates." };
    if (!from && !to) return { error: "Choose a start date, an end date, or both." };
    if (from && to && from > to) return { from, to, error: "The start date must be on or before the end date." };
  }

  const fromInstant = from ? localToUtc(from, "00:00", input.timeZone)?.toISOString() : undefined;
  const toExclusiveInstant = to
    ? localToUtc(addDaysToLocalDate(to, 1), "00:00", input.timeZone)?.toISOString()
    : undefined;
  return { from, to, fromInstant, toExclusiveInstant };
}
