import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { publicEventDate } from "@/components/calendar/public-event";
import { addDaysToLocalDate,addMonthsToLocalDate,isLocalDate,todayInZone } from "@/lib/datetime";
import { readPublicCalendar,readPublicTimezone } from "@/lib/public-calendar/data";
import { publicEventPath } from "@/lib/public-calendar/types";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Church Calendar",description:"Upcoming public events at Stonehill SDA Church."};

export default async function PublicCalendar({searchParams}:PageProps<"/calendar">) {
  const query=await searchParams; const timezone=await readPublicTimezone().catch(() => null);
  if (!timezone) return <div className="page-container py-10"><PageHeader title="Church Calendar" /><p role="alert">The calendar is temporarily unavailable. Please try again later.</p></div>;
  const today=todayInZone(timezone);
  const selected=typeof query.date === "string" && isLocalDate(query.date) ? query.date : today;
  const from=`${selected.slice(0,7)}-01`;
  const to=addDaysToLocalDate(addMonthsToLocalDate(from,1),-1);
  const offset=typeof query.offset === "string" && /^\d+$/.test(query.offset) && Number(query.offset)<=100000 ? Number(query.offset) : 0;
  const result=await readPublicCalendar(from,to,100,offset).then(data => ({data,error:false})).catch(() => ({data:null,error:true}));
  const title=new Date(`${from}T12:00:00Z`).toLocaleString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
  const link=(date:string) => `/calendar?date=${date}`;
  return <div className="page-container space-y-6 py-10">
    <PageHeader title="Church Calendar" description="Discover upcoming public events at Stonehill." />
    <nav aria-label="Calendar feeds" className="flex flex-wrap gap-4 text-sm"><a className="underline" href="/api/calendar/public.ics">Subscribe to calendar (.ics)</a><a className="underline" href="/api/calendar/public.json">Public calendar JSON</a></nav>
    <div className="flex flex-wrap items-center gap-4"><Link className="rounded border px-3 py-2 underline" href={link(addMonthsToLocalDate(from,-1))} aria-label="Previous month">Previous</Link>
      <h2 className="text-xl font-semibold">{title}</h2><Link className="rounded border px-3 py-2 underline" href={link(addMonthsToLocalDate(from,1))} aria-label="Next month">Next</Link>
      <Link className="underline" href={link(today)}>Today</Link></div>
    {result.error ? <p role="alert">The calendar is temporarily unavailable. Please try again later.</p> : result.data?.events.length ? <ol className="space-y-3">
      {result.data.events.map(event => <li key={event.uid} className="rounded-xl border bg-card p-4"><h3 className="text-lg font-semibold"><Link className="underline" href={publicEventPath(event.uid)}>{event.title}</Link></h3><p className="text-sm text-muted-foreground">{publicEventDate(event)}</p></li>)}
    </ol> : <p>No public events in this month.</p>}
    {offset>0 ? <Link className="mr-5 underline" href={`/calendar?date=${from}&offset=${Math.max(0,offset-100)}`}>Previous events</Link> : null}
    {result.data?.has_more ? <Link className="underline" href={`/calendar?date=${from}&offset=${offset+100}`}>More events</Link> : null}
  </div>;
}
