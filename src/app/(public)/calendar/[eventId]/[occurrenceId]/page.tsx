import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicEventContent } from "@/components/calendar/public-event";
import { readPublicCalendarEvent } from "@/lib/public-calendar/data";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Church Calendar Event"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublicCalendarEvent({params}:PageProps<"/calendar/[eventId]/[occurrenceId]">) {
  const {eventId,occurrenceId}=await params;
  if (!uuid.test(eventId) || !uuid.test(occurrenceId)) notFound();
  const event=await readPublicCalendarEvent(eventId,occurrenceId);
  if (!event) notFound();
  return <article className="page-container space-y-5 py-10"><Link className="underline" href={`/calendar?date=${event.local_start_date}`}>Back to Church Calendar</Link>
    <h1 className="text-3xl font-semibold">{event.title}</h1><PublicEventContent event={event} /></article>;
}
