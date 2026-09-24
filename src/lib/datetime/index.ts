import { tz, TZDate } from "@date-fns/tz";
import { format, isValid, parse } from "date-fns";

/**
 * All wall-clock math for the church happens here. Dates are "YYYY-MM-DD" strings and
 * times are "HH:mm" strings in the church timezone (app_settings.timezone); instants are
 * UTC Date objects / ISO strings. Keeping local dates as plain strings avoids the classic
 * bug of a JS Date shifting a calendar day across time zones.
 */

/** "YYYY-MM-DD" */
export type LocalDate = string;
/** "HH:mm" (24-hour) */
export type LocalTime = string;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLocalDate(value: string): value is LocalDate {
  return LOCAL_DATE.test(value) && isValid(parse(value, "yyyy-MM-dd", new Date()));
}

export function isLocalTime(value: string): value is LocalTime {
  return LOCAL_TIME.test(value);
}

/** Today's calendar date in the given timezone. */
export function todayInZone(timeZone: string, now: Date = new Date()): LocalDate {
  return format(now, "yyyy-MM-dd", { in: tz(timeZone) });
}

/** Local date + time of an instant in the given timezone. */
export function toLocalParts(instant: Date | string, timeZone: string): { date: LocalDate; time: LocalTime } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return {
    date: format(d, "yyyy-MM-dd", { in: tz(timeZone) }),
    time: format(d, "HH:mm", { in: tz(timeZone) }),
  };
}

/**
 * Converts a local wall-clock date/time in `timeZone` to a UTC instant. Returns null for
 * a local time that doesn't exist (the spring-forward gap), so the user's selected time
 * is never silently moved.
 */
export function localToUtc(date: LocalDate, time: LocalTime, timeZone: string): Date | null {
  if (!isLocalDate(date) || !isLocalTime(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const zoned = new TZDate(y, m - 1, d, hh, mm, 0, 0, timeZone);
  const roundTrip = toLocalParts(new Date(zoned.getTime()), timeZone);
  if (roundTrip.date !== date || roundTrip.time !== time) return null;
  return new Date(zoned.getTime());
}

/**
 * Calendar arithmetic on local dates. Done with Date.UTC so neither the church timezone
 * nor the server's own timezone (and its DST changes) can shift the result.
 */
export function addDaysToLocalDate(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number);
  return utcMidnightToLocalDate(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Adds calendar months, clamping to the month's last day (Jan 31 + 1 month = Feb 28). */
export function addMonthsToLocalDate(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  return utcMidnightToLocalDate(
    new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(d, lastDay))),
  );
}

/** A Date at 00:00 UTC for a local date — only for date-level arithmetic and formatting. */
export function localDateToUtcMidnight(date: LocalDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function utcMidnightToLocalDate(value: Date): LocalDate {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minutesOfDay(time: LocalTime): number {
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
}

export function timeFromMinutes(minutes: number): LocalTime {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Postgres `time` values arrive as "HH:mm:ss". */
export function normalizeTime(value: string): LocalTime {
  return value.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Display formatting (en-US)
// ---------------------------------------------------------------------------

/** "Wednesday, October 1, 2026" */
export function formatLongDate(date: LocalDate): string {
  return format(localDateToUtcMidnight(date), "EEEE, MMMM d, yyyy", { in: tz("UTC") });
}

/** "Wed, Oct 1" */
export function formatShortDate(date: LocalDate): string {
  return format(localDateToUtcMidnight(date), "EEE, MMM d", { in: tz("UTC") });
}

/** "Thu, Oct 1, 2026" */
export function formatCompactDate(date: LocalDate): string {
  return format(localDateToUtcMidnight(date), "EEE, MMM d, yyyy", { in: tz("UTC") });
}

/** "Oct 1, 2026" */
export function formatMediumDate(date: LocalDate): string {
  return format(localDateToUtcMidnight(date), "MMM d, yyyy", { in: tz("UTC") });
}

/** "9:00 AM" */
export function formatTime(time: LocalTime): string {
  const minutes = minutesOfDay(time);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const suffix = hh < 12 ? "AM" : "PM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** "9:00 AM – 10:30 AM" */
export function formatTimeRange(start: LocalTime, end: LocalTime): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** Formats an instant in the church timezone, e.g. "Oct 1, 2026, 9:00 AM". */
export function formatInstant(instant: Date | string, timeZone: string, pattern = "MMM d, yyyy, h:mm a"): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return format(d, pattern, { in: tz(timeZone) });
}

/** Short timezone name for the given date, e.g. "CDT" / "CST". */
export function timeZoneAbbreviation(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}
