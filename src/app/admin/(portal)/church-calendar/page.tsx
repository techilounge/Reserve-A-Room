import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/guards";
import { datesBetween, dayOfWeek, shiftAnchor, viewRange } from "@/lib/calendar";
import { addDaysToLocalDate, addMonthsToLocalDate, formatLongDate, formatTime, isLocalDate, toLocalParts, todayInZone, type LocalDate } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Church Calendar" };
const VIEWS = ["year", "month", "week", "day", "agenda"] as const;
type View = (typeof VIEWS)[number];
type RawEntry = Database["public"]["Functions"]["calendar_master_entries"]["Returns"][number];
type Entry = RawEntry & { first: LocalDate; last: LocalDate; time: string; conflict: boolean };
type Option = { id: string; name: string };
type Options = { cycles: Option[]; ministries: Option[]; rooms: Option[]; resources: Option[] };
const selectClass = "min-h-10 w-full rounded-lg border border-input bg-background px-2 text-sm";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function options(value: Json | null): Options {
  if (!value || Array.isArray(value) || typeof value !== "object") return { cycles: [], ministries: [], rooms: [], resources: [] };
  const list = (key: string): Option[] => Array.isArray(value[key]) ? (value[key] as Json[]).flatMap(item =>
    item && !Array.isArray(item) && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string"
      ? [{ id:item.id, name:item.name }] : []) : [];
  return { cycles:list("cycles"), ministries:list("ministries"), rooms:list("rooms"), resources:list("resources") };
}

function names(value: Json): string {
  return Array.isArray(value) ? value.flatMap(item => item && !Array.isArray(item) && typeof item === "object" && typeof item.name === "string" ? [item.name] : []).join(", ") : "";
}

function EntryLink({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const href = entry.kind === "reservation" ? `/admin/reservations/${entry.entry_id}` : `/admin/calendar-submissions/occurrences/${entry.submission_id}`;
  return <Link href={href} className={cn("block rounded-lg border px-2 py-1.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    entry.status === "approved" ? "border-success-border bg-success-soft text-success-soft-foreground" : entry.status === "cancelled" ? "border-neutral-border bg-neutral-soft text-neutral-soft-foreground" : "border-warning-border bg-warning-soft text-warning-soft-foreground")}>
    <span className="font-semibold">{entry.all_day ? "All day" : entry.time} · {entry.title}</span>
    {!compact ? <span className="block">{entry.kind === "reservation" ? "Room reservation" : entry.status} · {entry.ministry_name}{names(entry.rooms) ? ` · ${names(entry.rooms)}` : ""}{names(entry.resources) ? ` · ${names(entry.resources)}` : ""}</span> : null}
    {entry.conflict ? <span className="block font-semibold">Conflict or warning</span> : null}
  </Link>;
}

export default async function ChurchCalendarPage({ searchParams }: PageProps<"/admin/church-calendar">) {
  if (!(await hasPermission("calendar.view"))) return null;
  const canManage = await hasPermission("churchCalendar.manage");
  const raw = await searchParams;
  const str = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const view: View = VIEWS.includes(str("view") as View) ? str("view") as View : "month";
  const catalog = await loadCatalog();
  const zone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const today = todayInZone(zone);
  const anchor = isLocalDate(str("date")) ? str("date") as LocalDate : today;
  const selectedLayers = raw.filters === "1" ? (Array.isArray(raw.layer) ? raw.layer : raw.layer ? [raw.layer] : []) : ["approved", "proposed", "rooms"];
  const conflictFilter = ["with", "without"].includes(str("conflict_status")) ? str("conflict_status") : "";
  const showConflicts = str("conflicts") === "1" || Boolean(conflictFilter);
  const status = ["approved", "proposed", "cancelled", "pending"].includes(str("status")) ? str("status") : "";
  const scope = ["ministry", "church_wide", "administrative", "community"].includes(str("scope")) ? str("scope") : "";
  const visibility = ["public", "internal"].includes(str("visibility")) ? str("visibility") : "";
  const ids = Object.fromEntries(["cycle", "ministry", "room", "resource"].map(key => [key, uuid.test(str(key)) ? str(key) : ""]));
  const range = view === "year" ? { from:`${anchor.slice(0,4)}-01-01` as LocalDate, to:`${anchor.slice(0,4)}-12-31` as LocalDate }
    : viewRange(view === "agenda" ? "month" : view, anchor);
  const supabase = await createSupabaseServerClient();
  const [result, choicesResult, conflictResult] = await Promise.all([
    supabase.rpc("calendar_master_entries", { p_from:range.from,p_to:range.to,p_cycle:ids.cycle || undefined,p_ministry:ids.ministry || undefined,
      p_room:ids.room || undefined,p_resource:ids.resource || undefined,p_scope:scope || undefined,p_visibility:visibility || undefined,
      p_layer:selectedLayers.length === 1 && ["approved", "proposed", "rooms"].includes(selectedLayers[0]) ? selectedLayers[0] : "all" }),
    supabase.rpc("calendar_master_filter_options"),
    showConflicts ? supabase.rpc("calendar_master_conflicts", { p_from:range.from,p_to:range.to }) : Promise.resolve(null),
  ]);
  const choices = options(choicesResult.data);
  const conflicts = conflictResult?.data ?? [];
  const tooMany = (result.data?.length ?? 0) > 5000 || conflicts.length > 5000;
  const entries: Entry[] = tooMany ? [] : (result.data ?? []).filter(row => {
    const layer = row.kind === "reservation" ? "rooms" : row.status === "proposed" ? "proposed" : "approved";
    return selectedLayers.includes(layer) && (!status || row.status === status);
  }).map(row => {
    const first=toLocalParts(row.starts_at,zone); const last=toLocalParts(new Date(new Date(row.ends_at).getTime()-1),zone).date;
    const conflict=Boolean(row.event_id) && conflicts.some(c => (c.event_id===row.event_id || c.other_event_id===row.event_id ||
      (c.details && typeof c.details === "object" && !Array.isArray(c.details) && Array.isArray(c.details.participants) &&
        c.details.participants.some(p => p && typeof p === "object" && !Array.isArray(p) && p.event_id===row.event_id))) &&
        new Date(c.starts_at).getTime()<new Date(row.ends_at).getTime() && new Date(c.ends_at).getTime()>new Date(row.starts_at).getTime());
    return { ...row,first:first.date,last,time:formatTime(first.time),conflict };
  }).filter(entry => !conflictFilter || (conflictFilter === "with" ? entry.conflict : !entry.conflict));
  const byDay = new Map<LocalDate,Entry[]>();
  for (const entry of entries) for (let day=entry.first<range.from ? range.from : entry.first; day<=entry.last && day<=range.to; day=addDaysToLocalDate(day,1)) {
    byDay.set(day,[...(byDay.get(day) ?? []),entry]);
  }
  const href = (changes: Record<string,string>) => {
    const p=new URLSearchParams();
    for (const [key,value] of Object.entries(raw)) if (typeof value === "string") p.set(key,value); else if (Array.isArray(value)) for (const item of value) p.append(key,item);
    for (const [key,value] of Object.entries(changes)) p.set(key,value);
    return `/admin/church-calendar?${p.toString()}`;
  };
  const shifted = (direction:-1|1) => view === "year" ? addMonthsToLocalDate(anchor,12*direction)
    : shiftAnchor(view === "agenda" ? "month" : view,anchor,direction);
  const title=view === "year" ? anchor.slice(0,4) : view === "month" || view === "agenda"
    ? new Date(`${anchor.slice(0,7)}-01T12:00:00Z`).toLocaleString("en-US",{ month:"long",year:"numeric",timeZone:"UTC" })
    : view === "week" ? `${formatLongDate(range.from)} – ${formatLongDate(range.to)}` : formatLongDate(anchor);
  const days=datesBetween(range.from,range.to);
  const hasError=Boolean(result.error || choicesResult.error || conflictResult?.error);
  const activeDays=days.filter(day => byDay.has(day));
  const filterOptions = (items:Option[]) => items.map(item => <option key={item.id} value={item.id}>{item.name}</option>);
  return <div className="space-y-6">
    <PageHeader title="Church Calendar" description="View approved events, proposals and room reservations in the church time zone." />
    {canManage ? <Button asChild variant="outline" size="sm"><Link href="/admin/church-calendar/setup">Manage calendar setup</Link></Button> : null}
    <div className="flex flex-wrap items-center gap-2"><Button asChild variant="outline" size="icon"><Link href={href({date:shifted(-1)})} aria-label="Previous period"><ChevronLeft aria-hidden /></Link></Button>
      <Button asChild variant="outline" size="sm"><Link href={href({date:today})}>Today</Link></Button>
      <Button asChild variant="outline" size="icon"><Link href={href({date:shifted(1)})} aria-label="Next period"><ChevronRight aria-hidden /></Link></Button>
      <h2 className="text-lg font-semibold" aria-live="polite">{title}</h2></div>
    <nav aria-label="Church Calendar view" className="flex flex-wrap gap-1 rounded-lg border p-1">{VIEWS.map(v => <Link key={v} href={href({view:v})} aria-current={v===view ? "page" : undefined} className={cn("min-h-10 rounded-md px-3 py-2 text-sm capitalize focus-visible:outline-2 focus-visible:outline-ring",v===view ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>{v}</Link>)}</nav>
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Filters and layers</summary>
      <form action="/admin/church-calendar" className="mt-4 space-y-4"><input type="hidden" name="filters" value="1" /><input type="hidden" name="view" value={view} /><input type="hidden" name="date" value={anchor} />
        <fieldset><legend className="text-sm font-semibold">Show layers</legend><div className="mt-2 flex flex-wrap gap-4">{[["approved","Approved and cancelled events"],["proposed","Proposed events"],["rooms","Room reservations"]].map(([value,label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="layer" value={value} defaultChecked={selectedLayers.includes(value)} />{label}</label>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="conflicts" value="1" defaultChecked={showConflicts} />Conflict indicators</label></div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Cycle<select name="cycle" defaultValue={ids.cycle} className={selectClass}><option value="">All cycles</option>{filterOptions(choices.cycles)}</select></label>
          <label className="text-sm">Ministry<select name="ministry" defaultValue={ids.ministry} className={selectClass}><option value="">All ministries</option>{filterOptions(choices.ministries)}</select></label>
          <label className="text-sm">Room<select name="room" defaultValue={ids.room} className={selectClass}><option value="">All rooms</option>{filterOptions(choices.rooms)}</select></label>
          <label className="text-sm">Resource<select name="resource" defaultValue={ids.resource} className={selectClass}><option value="">All resources</option>{filterOptions(choices.resources)}</select></label>
          <label className="text-sm">Status<select name="status" defaultValue={status} className={selectClass}><option value="">All statuses</option><option value="approved">Approved</option><option value="proposed">Proposed</option><option value="pending">Pending reservation</option><option value="cancelled">Cancelled</option></select></label>
          <label className="text-sm">Scope<select name="scope" defaultValue={scope} className={selectClass}><option value="">All scopes</option><option value="church_wide">Church-wide</option><option value="ministry">Ministry</option><option value="administrative">Administrative</option><option value="community">Community</option></select></label>
          <label className="text-sm">Visibility<select name="visibility" defaultValue={visibility} className={selectClass}><option value="">Public and internal</option><option value="public">Public</option><option value="internal">Internal</option></select></label>
          <label className="text-sm">Conflict status<select name="conflict_status" defaultValue={conflictFilter} className={selectClass}><option value="">All entries</option><option value="with">With conflicts or warnings</option><option value="without">Without conflicts or warnings</option></select></label>
        </div><Button type="submit" size="sm">Apply filters</Button></form></details>
    {hasError ? <p role="alert">Church Calendar data is unavailable. Check the database migration and try again.</p> : tooMany ? <p role="alert">This period has more than 5,000 entries. Choose a shorter period or narrower filters.</p> : null}
    {view === "year" && !hasError && !tooMany ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({length:12},(_,i) => {
      const month=`${anchor.slice(0,4)}-${String(i+1).padStart(2,"0")}-01` as LocalDate;
      const monthDays=datesBetween(month,addDaysToLocalDate(addMonthsToLocalDate(month,1),-1));
      return <section key={month} className="rounded-xl border bg-card p-3"><h3 className="font-semibold"><Link className="underline" href={href({view:"month",date:month})}>{new Date(`${month}T12:00:00Z`).toLocaleString("en-US",{month:"long",timeZone:"UTC"})}</Link></h3>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground" aria-hidden>{["S","M","T","W","T","F","S"].map((label,index) => <span key={index}>{label}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">{Array.from({length:dayOfWeek(month)},(_,index) => <span key={`empty-${index}`} aria-hidden />)}{monthDays.map(day => <Link key={day} href={href({view:"day",date:day})} aria-label={`${formatLongDate(day)}, ${(byDay.get(day) ?? []).length} entries${byDay.get(day)?.some(entry => entry.conflict) ? ", conflict or warning" : ""}`} className={cn("flex min-h-9 items-center justify-center rounded text-xs focus-visible:outline-2 focus-visible:outline-ring",byDay.has(day) ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-accent",byDay.get(day)?.some(entry => entry.conflict) && "ring-2 ring-destructive")}>{Number(day.slice(8))}</Link>)}</div></section>;
    })}</div> : null}
    {view !== "year" && !hasError && !tooMany ? <>
      {view !== "agenda" && view !== "day" ? <div className="hidden overflow-hidden rounded-xl border bg-card lg:block"><div className="grid grid-cols-7 border-b text-center text-xs font-semibold">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(day => <span key={day} className="py-2">{day}</span>)}</div><div className="grid grid-cols-7">{days.map(day => <section key={day} className="min-h-28 border-r border-b p-2"><Link href={href({view:"day",date:day})} className="font-semibold underline" aria-label={formatLongDate(day)}>{Number(day.slice(8))}</Link><div className="mt-1 space-y-1">{(byDay.get(day) ?? []).slice(0,3).map(entry => <EntryLink key={`${day}-${entry.entry_id}`} entry={entry} compact />)}{(byDay.get(day)?.length ?? 0)>3 ? <Link href={href({view:"day",date:day})} className="text-xs underline">More entries</Link> : null}</div></section>)}</div></div> : null}
      <div className={cn("space-y-3",view !== "agenda" && view !== "day" && "lg:hidden")}>{activeDays.length ? activeDays.map(day => <section key={day} className="rounded-xl border bg-card p-3"><h3 className="mb-2 font-semibold">{formatLongDate(day)}</h3><ul className="space-y-2">{byDay.get(day)!.map(entry => <li key={`${day}-${entry.entry_id}`}><EntryLink entry={entry} /></li>)}</ul></section>) : <p className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">No entries in this period.</p>}</div>
    </> : null}
  </div>;
}
