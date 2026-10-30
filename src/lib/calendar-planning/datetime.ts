import { localToUtc, toLocalParts } from "@/lib/datetime";

/** Interpret a datetime-local field in the configured church timezone. */
export function calendarLocalToInstant(value: string, timeZone: string): string | undefined {
  const [date, time, ...extra] = value.split("T");
  if (!date || !time || extra.length) return undefined;
  return localToUtc(date, time, timeZone)?.toISOString();
}

/** Convert a saved instant back to the datetime-local representation shown to staff. */
export function calendarInstantToLocal(value: string, timeZone: string): string {
  const parts = toLocalParts(value, timeZone);
  return `${parts.date}T${parts.time}`;
}
