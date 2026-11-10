import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().refine(value => Number.isFinite(Date.parse(value)));
export const publicCalendarEvent = z.object({
  uid:z.string().regex(/^[0-9a-f-]{36}-[0-9a-f-]{36}@reservearoom\.stonehillchurch\.org$/i),
  title:z.string().min(1).max(200),description:z.string().max(5000).nullable(),location:z.string().max(5000).nullable(),
  starts_at:instant,ends_at:instant,local_start_date:date,local_end_date:date,
  timezone:z.string().min(1).max(100),all_day:z.boolean(),sequence:z.number().int().nonnegative(),last_modified:instant,
});
export const publicCalendarPayload = z.object({version:z.literal(1),timezone:z.string().min(1).max(100),has_more:z.boolean(),events:z.array(publicCalendarEvent)});
export const publicCalendarCancellation = publicCalendarEvent.pick({uid:true,sequence:true,last_modified:true,starts_at:true,ends_at:true,local_start_date:true,local_end_date:true,timezone:true,all_day:true}).extend({status:z.literal("cancelled")});
export const publicCalendarSyncPayload = z.object({version:z.literal(1),timezone:z.string().min(1).max(100),has_more:z.boolean(),events:z.array(z.union([publicCalendarEvent.extend({status:z.literal("published")}),publicCalendarCancellation]))});
export type PublicCalendarEvent = z.infer<typeof publicCalendarEvent>;
export type PublicCalendarCancellation = z.infer<typeof publicCalendarCancellation>;
export type PublicCalendarPayload = z.infer<typeof publicCalendarPayload>;

export function publicEventPath(uid:string):string {
  return `/calendar/${uid.slice(0,36)}/${uid.slice(37,73)}`;
}
