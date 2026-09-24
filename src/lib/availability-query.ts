import {
  compareLocalDates,
  isLocalDate,
  isLocalTime,
  minutesOfDay,
  timeFromMinutes,
  type LocalDate,
  type LocalTime,
} from "@/lib/datetime";

/** URL state of the public availability page (shared by server page and client filters). */
export type AvailabilityQuery = {
  date: LocalDate;
  room: string;
  capacity: string;
  from: LocalTime | "";
  to: LocalTime | "";
};

export function toSearch(query: AvailabilityQuery): string {
  const params = new URLSearchParams({ date: query.date });
  if (query.room) params.set("room", query.room);
  if (query.capacity) params.set("capacity", query.capacity);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return `/availability?${params.toString()}`;
}

/** Every bookable boundary between dayStart and dayEnd on the interval grid. */
export function timeGrid(dayStart: LocalTime, dayEnd: LocalTime, intervalMinutes: number): LocalTime[] {
  const times: LocalTime[] = [];
  for (let m = minutesOfDay(dayStart); m <= minutesOfDay(dayEnd); m += intervalMinutes) {
    times.push(timeFromMinutes(m));
  }
  return times;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Parses and sanitizes untrusted query parameters. */
export function parseAvailabilityQuery(
  raw: RawParams,
  bounds: { today: LocalDate; maxDate: LocalDate; grid: readonly LocalTime[] },
): AvailabilityQuery {
  const rawDate = first(raw.date);
  let date = isLocalDate(rawDate) ? rawDate : bounds.today;
  if (compareLocalDates(date, bounds.today) < 0) date = bounds.today;
  if (compareLocalDates(date, bounds.maxDate) > 0) date = bounds.maxDate;

  const room = first(raw.room).slice(0, 80).replace(/[^a-z0-9-]/g, "");
  const capacityNumber = Number.parseInt(first(raw.capacity), 10);
  const capacity = Number.isFinite(capacityNumber) && capacityNumber > 0 && capacityNumber <= 10000 ? String(capacityNumber) : "";

  const onGrid = (t: string) => isLocalTime(t) && bounds.grid.includes(t);
  let from = onGrid(first(raw.from)) ? first(raw.from) : "";
  let to = onGrid(first(raw.to)) ? first(raw.to) : "";
  if (from && to && to <= from) to = "";
  if (!from) to = "";
  if (from && !to) from = "";

  return { date, room, capacity, from, to };
}
