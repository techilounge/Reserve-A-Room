import { readPublicSyncFeed } from "@/lib/public-calendar/data";
import { CalendarInputError, calendarFailure, pageInteger, publicRange, revalidatedResponse } from "@/lib/public-calendar/request";

export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const url=new URL(request.url); const {from,to}=await publicRange(url);
    const limit=pageInteger(url.searchParams.get("limit"),100,200);
    const offset=pageInteger(url.searchParams.get("offset"),0,100000);
    if (limit<1) throw new CalendarInputError("Limit must be at least one.");
    const data=await readPublicSyncFeed(from,to,limit,offset);
    const events=data.events.map(event => event.status === "cancelled" ? {
      uid:event.uid,status:event.status,sequence:event.sequence,last_modified:event.last_modified,
    } : event);
    return revalidatedResponse(request,JSON.stringify({...data,events,from,to,offset,limit,next_offset:data.has_more ? offset+limit : null}),"application/json; charset=utf-8");
  } catch (error) { return calendarFailure(error); }
}
