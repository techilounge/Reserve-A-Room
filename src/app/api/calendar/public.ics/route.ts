import { getAppUrl } from "@/lib/app-url";
import { readPublicCalendar } from "@/lib/public-calendar/data";
import { createPublicIcal } from "@/lib/public-calendar/ical";
import { calendarFailure, publicRange, revalidatedResponse } from "@/lib/public-calendar/request";

export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const {from,to}=await publicRange(new URL(request.url));
    const data=await readPublicCalendar(from,to,5000);
    if (data.has_more) return Response.json({error:"Too many events. Choose a shorter date range."},{status:413,headers:{"Cache-Control":"no-store"}});
    return revalidatedResponse(request,createPublicIcal(data.events,getAppUrl().origin),"text/calendar; charset=utf-8");
  } catch (error) { return calendarFailure(error); }
}
