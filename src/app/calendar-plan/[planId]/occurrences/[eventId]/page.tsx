import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import { hashPlannerBearer } from "@/lib/calendar-planning/token";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { setOccurrenceException } from "../../actions";
import type { PlannerCatalog } from "../../event-form";

export const metadata: Metadata = { title: "Calendar dates and requests", robots: { index: false, follow: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PAGE_SIZE = 25;
type Entry = { id: string; origin: string; name?: string; active?: boolean; quantity?: number; notes?: string | null; operation?: string };
type Occurrence = { id: string; local_start: string; local_end: string; timezone: string; all_day: boolean; editable: boolean;
  rooms: Entry[]; resources: Entry[]; room_exceptions: Entry[]; resource_exceptions: Entry[] };
type Portal = PlannerCatalog & { status: string; events: { id: string; title: string; draft_version: number }[] };
const field = "block w-full rounded border border-input bg-background p-2";

function displayRange(occurrence: Occurrence) {
  const start = occurrence.local_start.replace("T", " ").slice(0, 16);
  const end = occurrence.local_end.replace("T", " ").slice(0, 16);
  if (!occurrence.all_day) return `${start} to ${end}`;
  const last = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  return `${start.slice(0, 10)} through ${last.toISOString().slice(0, 10)} · All day`;
}

export default async function PlannerOccurrencesPage({ params, searchParams }: {
  params: Promise<{ planId: string; eventId: string }>;
  searchParams: Promise<{ page?: string; error?: string; updated?: string }>;
}) {
  const { planId, eventId } = await params;
  const query = await searchParams;
  const session = (await cookies()).get("calendar_planner")?.value;
  let portal: Portal | null = null;
  let occurrences: Occurrence[] | null = null;
  if (UUID.test(planId) && UUID.test(eventId) && session && TOKEN.test(session)) {
    const client = createSupabaseServiceClient();
    const credentials = { p_plan_id: planId, p_session_hash: hashPlannerBearer(session) };
    const { data } = await client.rpc("calendar_planner_portal", credentials);
    portal = data as Portal | null;
    if (portal?.events.some(event => event.id === eventId)) {
      const result = await client.rpc("calendar_planner_occurrences", { ...credentials, p_event_id: eventId });
      occurrences = result.data as Occurrence[] | null;
    }
  }
  const event = portal?.events.find(item => item.id === eventId);
  if (!portal || !event || !occurrences) return <main className="mx-auto max-w-3xl space-y-4 px-5 py-12">
    <h1 className="text-2xl font-semibold">Planning access unavailable</h1>
    <p>This event or planning session is unavailable. Contact the church office for help.</p>
  </main>;
  const pages = Math.max(1, Math.ceil(occurrences.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  const items = occurrences.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (number: number) => `/calendar-plan/${planId}/occurrences/${eventId}?page=${number}`;
  const name = (id: string, items: { id: string; name: string }[]) => items.find(item => item.id === id)?.name ?? "Unavailable item";
  const editing = portal.status === "draft" || portal.status === "changes_requested";
  return <main className="mx-auto max-w-3xl space-y-5 px-5 py-12">
    <Link className="underline" href={`/calendar-plan/${planId}`}>Back to your plan</Link>
    <h1 className="text-2xl font-semibold">{event.title}: {editing ? "draft dates" : "submitted dates"}</h1>
    <p>{editing ? "These dates reflect the latest complete, valid schedule saved for this event. Complete an unfinished schedule before relying on this preview. " : "These are the last submitted dates and requests. "}They are proposals and do not reserve rooms or resources. {editing ? "Changes are included when you submit your plan." : ""}</p>
    {query.updated ? <p role="status">Change saved for your next submission.</p> : null}
    {query.error ? <p role="alert">The change could not be saved. The event may have changed or the selected item may be unavailable; review the current plan and try again.</p> : null}
    {!items.length ? <p>No dates are available yet. Save a complete schedule to see its dates.</p> : null}
    <ol className="space-y-4">{items.map(occurrence => <li key={occurrence.id} className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">{displayRange(occurrence)} ({occurrence.timezone})</h2>
      <p>{editing ? "Requested" : "Submitted"} rooms: {occurrence.rooms.map(item => name(item.id, portal.rooms)).join(", ") || "None"}</p>
      <p>{editing ? "Requested" : "Submitted"} resources: {occurrence.resources.map(item => `${name(item.id, portal.resources)} (${item.quantity})`).join(", ") || "None"}</p>
      {occurrence.room_exceptions.length || occurrence.resource_exceptions.length ? <p className="text-sm">Pending or applied exceptions: {[...occurrence.room_exceptions.map(item => `${item.name ?? name(item.id, portal.rooms)}: ${item.operation}`), ...occurrence.resource_exceptions.map(item => `${item.name ?? name(item.id, portal.resources)}: ${item.operation}${item.quantity ? ` (${item.quantity})` : ""}`)].join(", ")}.</p> : null}
      {editing && occurrence.editable ? <details><summary>Change requests for this date</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {(["room", "resource"] as const).map(kind => <form action={setOccurrenceException} key={kind} className="space-y-2 rounded border p-3">
            <input type="hidden" name="plan" value={planId} /><input type="hidden" name="event" value={eventId} />
            <input type="hidden" name="occurrence" value={occurrence.id} /><input type="hidden" name="draft_version" value={event.draft_version} />
            <input type="hidden" name="kind" value={kind} /><input type="hidden" name="page" value={page} />
            <label className="block">{kind === "room" ? "Room" : "Resource"}<select className={field} name="item" required defaultValue="">
              <option value="" disabled>Choose {kind}</option>{(() => {
                const catalog = kind === "room" ? portal.rooms : portal.resources;
                const exceptions = kind === "room" ? occurrence.room_exceptions : occurrence.resource_exceptions;
                const options = [...catalog.filter(item => item.active || exceptions.some(exception => exception.id === item.id)),
                  ...exceptions.filter(item => !catalog.some(existing => existing.id === item.id)).map(item => ({ id: item.id, name: item.name ?? "Unavailable item", active: item.active ?? false }))];
                return options.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (inactive — remove or restore only)"}</option>);
              })()}
            </select></label>
            <label className="block">Change<select className={field} name="operation" defaultValue="add"><option value="add">Add request</option><option value="remove">Remove request</option>{kind === "resource" ? <option value="quantity_override">Change quantity</option> : null}<option value="reset">Restore event default</option></select></label>
            {kind === "resource" ? <label className="block">Quantity for add or change<input className={field} type="number" name="quantity" min={1} max={100000} /></label> : null}
            <label className="block">Note<input className={field} name="notes" maxLength={1000} /></label>
            <Button type="submit">Save {kind} change</Button>
          </form>)}
        </div>
      </details> : null}
    </li>)}</ol>
    {pages > 1 ? <nav className="flex items-center justify-between" aria-label="Submitted date pages">
      {page > 1 ? <Link className="underline" href={href(page - 1)}>Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className="underline" href={href(page + 1)}>Next</Link> : <span />}
    </nav> : null}
  </main>;
}
