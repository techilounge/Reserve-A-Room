import type { PublicCalendarEvent } from "@/lib/public-calendar/types";
import { addDaysToLocalDate, formatInstant, formatLongDate } from "@/lib/datetime";

export function publicEventDate(event:PublicCalendarEvent):string {
  if (event.all_day) {
    const last=addDaysToLocalDate(event.local_end_date,-1);
    return `${formatLongDate(event.local_start_date)}${last===event.local_start_date ? "" : ` – ${formatLongDate(last)}`} · All day (${event.timezone})`;
  }
  return `${formatInstant(event.starts_at,event.timezone)} – ${formatInstant(event.ends_at,event.timezone)} (${event.timezone})`;
}

export function PublicEventContent({event}:{event:PublicCalendarEvent}) {
  return <div className="space-y-3"><p>{publicEventDate(event)}</p>{event.location ? <p>Location: {event.location}</p> : null}
    {event.description ? <p className="whitespace-pre-wrap break-words">{event.description}</p> : null}</div>;
}
