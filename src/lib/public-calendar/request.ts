import "server-only";
import { createHash } from "node:crypto";
import { addDaysToLocalDate, isLocalDate, localDateToUtcMidnight, todayInZone } from "@/lib/datetime";
import { readPublicTimezone } from "./data";

export class CalendarInputError extends Error {}

export async function publicRange(url:URL) {
  const from=url.searchParams.get("from") ?? todayInZone(await readPublicTimezone());
  if (!isLocalDate(from)) throw new CalendarInputError("Invalid start date.");
  const to=url.searchParams.get("to") ?? addDaysToLocalDate(from,365);
  if (!isLocalDate(to) || to<from || localDateToUtcMidnight(to).getTime()-localDateToUtcMidnight(from).getTime()>365*86400000) {
    throw new CalendarInputError("Choose a range of at most 366 calendar dates.");
  }
  return {from,to};
}

export function pageInteger(value:string | null,defaultValue:number,max:number):number {
  if (value===null) return defaultValue;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) throw new CalendarInputError("Invalid page parameter.");
  return Number(value);
}

/** Storage may retain the representation, but every use revalidates against live data. */
export function revalidatedResponse(request:Request,body:string,contentType:string):Response {
  const etag=`"${createHash("sha256").update(body).digest("hex")}"`;
  const headers={"Content-Type":contentType,"Cache-Control":"public, max-age=0, must-revalidate", "Vercel-CDN-Cache-Control":"no-store",ETag:etag};
  const tags=(request.headers.get("if-none-match") ?? "").split(",").map(value => value.trim().replace(/^W\//,""));
  return tags.includes(etag) || tags.includes("*") ? new Response(null,{status:304,headers}) : new Response(body,{status:200,headers});
}

export function calendarFailure(error:unknown):Response {
  return Response.json({error:error instanceof CalendarInputError ? error.message : "Public calendar is temporarily unavailable."},
    {status:error instanceof CalendarInputError ? 400 : 503,headers:{"Cache-Control":"no-store"}});
}
