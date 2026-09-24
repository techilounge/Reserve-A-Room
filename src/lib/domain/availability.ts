import {
  compareLocalDates,
  minutesOfDay,
  timeFromMinutes,
  toLocalParts,
  todayInZone,
  type LocalDate,
  type LocalTime,
} from "@/lib/datetime";

/**
 * Pure availability math for one room on one local date. Works in minutes-of-day in the
 * church timezone; the bookable window (06:00–22:00 by default) never contains a DST
 * transition, so local minutes are safe. This is UX only — the database exclusion
 * constraint remains the final authority.
 */

/** A time the room is occupied, as UTC instants (from get_public_busy_blocks). */
export type BusyBlock = { start_at: string; end_at: string };

export type DayWindow = {
  date: LocalDate;
  timeZone: string;
  dayStart: LocalTime;
  dayEnd: LocalTime;
  intervalMinutes: number;
  /** Minimum notice before a reservation may start (app_settings.min_lead_time_minutes). */
  leadMinutes: number;
};

export type SegmentState = "available" | "unavailable" | "past";
export type Segment = { start: LocalTime; end: LocalTime; state: SegmentState };

type Range = [number, number];

/** Occupied minute ranges on the window's date, clipped and merged. */
export function busyRanges(window: DayWindow, busy: readonly BusyBlock[]): Range[] {
  const dayStart = minutesOfDay(window.dayStart);
  const dayEnd = minutesOfDay(window.dayEnd);
  const ranges: Range[] = [];
  for (const block of busy) {
    const start = toLocalParts(block.start_at, window.timeZone);
    const end = toLocalParts(block.end_at, window.timeZone);
    if (compareLocalDates(start.date, window.date) > 0 || compareLocalDates(end.date, window.date) < 0) continue;
    const s = Math.max(dayStart, start.date < window.date ? 0 : minutesOfDay(start.time));
    const e = Math.min(dayEnd, end.date > window.date ? 24 * 60 : minutesOfDay(end.time));
    if (e > s) ranges.push([s, e]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** First minute-of-day a new reservation may start, or null if the whole day is past. */
export function earliestStartMinute(window: DayWindow, now: Date = new Date()): number | null {
  const today = todayInZone(window.timeZone, now);
  const dayStart = minutesOfDay(window.dayStart);
  const order = compareLocalDates(window.date, today);
  if (order < 0) return null;
  if (order > 0) return dayStart;
  const nowLocal = toLocalParts(now, window.timeZone);
  // Strictly after "now + lead", rounded up to the next interval boundary.
  const threshold = minutesOfDay(nowLocal.time) + window.leadMinutes + 1;
  const rounded = Math.ceil(threshold / window.intervalMinutes) * window.intervalMinutes;
  return Math.max(dayStart, rounded);
}

function overlaps(ranges: readonly Range[], start: number, end: number): boolean {
  return ranges.some(([s, e]) => start < e && s < end);
}

function slotStarts(window: DayWindow): number[] {
  const starts: number[] = [];
  const end = minutesOfDay(window.dayEnd);
  for (let m = minutesOfDay(window.dayStart); m + window.intervalMinutes <= end; m += window.intervalMinutes) {
    starts.push(m);
  }
  return starts;
}

/** The day as merged available / unavailable / past segments, for display. */
export function daySegments(window: DayWindow, busy: readonly BusyBlock[], now: Date = new Date()): Segment[] {
  const ranges = busyRanges(window, busy);
  const earliest = earliestStartMinute(window, now);
  const segments: Segment[] = [];
  for (const start of slotStarts(window)) {
    const end = start + window.intervalMinutes;
    const state: SegmentState =
      earliest === null || start < earliest ? "past" : overlaps(ranges, start, end) ? "unavailable" : "available";
    const last = segments.at(-1);
    if (last && last.state === state) last.end = timeFromMinutes(end);
    else segments.push({ start: timeFromMinutes(start), end: timeFromMinutes(end), state });
  }
  return segments;
}

/** Start times a guest may pick. */
export function availableStartTimes(window: DayWindow, busy: readonly BusyBlock[], now: Date = new Date()): LocalTime[] {
  const ranges = busyRanges(window, busy);
  const earliest = earliestStartMinute(window, now);
  if (earliest === null) return [];
  return slotStarts(window)
    .filter((start) => start >= earliest && !overlaps(ranges, start, start + window.intervalMinutes))
    .map(timeFromMinutes);
}

/** End times available after a chosen start: up to the next occupied block or day end. */
export function availableEndTimes(window: DayWindow, busy: readonly BusyBlock[], start: LocalTime): LocalTime[] {
  const ranges = busyRanges(window, busy);
  const startMinute = minutesOfDay(start);
  const dayEnd = minutesOfDay(window.dayEnd);
  const ends: LocalTime[] = [];
  for (let end = startMinute + window.intervalMinutes; end <= dayEnd; end += window.intervalMinutes) {
    if (overlaps(ranges, startMinute, end)) break;
    ends.push(timeFromMinutes(end));
  }
  return ends;
}

/** Whether [start, end) is free, on the grid, inside the window, and not too soon. */
export function isRangeAvailable(
  window: DayWindow,
  busy: readonly BusyBlock[],
  start: LocalTime,
  end: LocalTime,
  now: Date = new Date(),
): boolean {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  const earliest = earliestStartMinute(window, now);
  return (
    earliest !== null &&
    s >= earliest &&
    e > s &&
    s % window.intervalMinutes === 0 &&
    e % window.intervalMinutes === 0 &&
    s >= minutesOfDay(window.dayStart) &&
    e <= minutesOfDay(window.dayEnd) &&
    !overlaps(busyRanges(window, busy), s, e)
  );
}

/** Minutes the room is free during the window (for "mostly booked" style summaries). */
export function availableMinutes(segments: readonly Segment[]): number {
  return segments
    .filter((s) => s.state === "available")
    .reduce((sum, s) => sum + minutesOfDay(s.end) - minutesOfDay(s.start), 0);
}
