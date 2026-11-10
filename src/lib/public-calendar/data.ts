import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env/public";
import type { Database } from "@/lib/supabase/database.types";
import { publicCalendarEvent, publicCalendarPayload, publicCalendarSyncPayload } from "./types";

/** A cookie-free anon read. Always re-query so revoked visibility is not cached. */
function publicClient() {
  const {url,publishableKey}=getSupabasePublicConfig();
  return createClient<Database>(url,publishableKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init) => fetch(input,{...init,cache:"no-store"})},
  });
}
export async function readPublicCalendar(from:string,to:string,limit:number,offset=0) {
  const {data,error}=await publicClient().rpc("calendar_public_occurrences",{p_from:from,p_to:to,p_limit:limit,p_offset:offset});
  if (error) throw error;
  return publicCalendarPayload.parse(data);
}
export async function readPublicSyncFeed(from:string,to:string,limit:number,offset=0) {
  const {data,error}=await publicClient().rpc("calendar_public_sync_feed",{p_from:from,p_to:to,p_limit:limit,p_offset:offset});
  if (error) throw error;
  return publicCalendarSyncPayload.parse(data);
}

export async function readPublicTimezone():Promise<string> {
  const {data,error}=await publicClient().from("app_settings").select("timezone").single();
  if (error || !data?.timezone) throw new Error("Calendar timezone unavailable");
  return data.timezone;
}

export async function readPublicCalendarEvent(eventId:string,occurrenceId:string) {
  const {data,error}=await publicClient().rpc("calendar_public_occurrence",{p_event:eventId,p_occurrence:occurrenceId});
  if (error) throw error;
  return data === null ? null : publicCalendarEvent.parse(data);
}
