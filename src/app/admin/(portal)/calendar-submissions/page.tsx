import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { requestCalendarChanges } from "./actions";

export const metadata: Metadata = { title: "Church Calendar Plans" };
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekName = (week: number) => ({ "-1": "last", "1": "first", "2": "second", "3": "third", "4": "fourth" })[String(week)] ?? String(week);
type Plan = { id: string; cycle: string; ministry: string; status: string; revision: number; submitted_at: string;
  message: string | null; events: { reference: string; title: string; start_date: string; end_date: string; start_time: string; end_time: string;
    timezone: string; schedule_kind: string; frequency: string | null; description: string | null; public_description: string | null;
    interval_count: number | null; weekdays: number[] | null; weekday: number | null; month_ordinals: number[] | null;
    month_ordinal: number | null; day_of_month: number | null; month_of_year: number | null;
    location_type: string; offsite_location: string | null; virtual_url: string | null; scope: string; protection: string;
    visibility: string; food_drinks_planned: boolean; setup_minutes: number; cleanup_minutes: number;
    public_contact_name: string | null; public_contact_email: string | null; estimated_attendance: number; requester_notes: string | null; rooms: string[]; ministries: string[];
    dates: string[]; resources: { name: string; quantity: number; notes: string | null }[] }[] };

export default async function CalendarSubmissions({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("calendar_staff_plan_list");
  const plans = (data ?? []) as Plan[];
  return <div className="space-y-6">
    <PageHeader title="Church Calendar Plans" description="Submitted ministry plans are proposals; no room or resource has been reserved." />
    {params.updated ? <p role="status">The planner can now revise this plan while its cycle is open.</p> : null}
    {params.error || error ? <p role="alert">Unable to complete the request. Check the cycle and try again.</p> : null}
    {!error && !plans.length ? <p>No submitted plans yet.</p> : null}
    <ol className="space-y-4">{plans.map(plan => <li key={plan.id} className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">{plan.ministry} · {plan.cycle}</h2>
      <p>Submission {plan.revision} · {plan.status.replaceAll("_", " ")}</p>
      {plan.message ? <p className="whitespace-pre-wrap">{plan.message}</p> : null}
      {plan.events.length ? <ul className="space-y-2">{plan.events.map(event => <li key={event.reference}>
        <details className="rounded border p-3"><summary>{event.title} · {event.reference}</summary>
          <div className="mt-2 space-y-2 text-sm">
            <p>{event.start_date} to {event.end_date} · {event.start_time}–{event.end_time} ({event.timezone})</p>
            <p>Schedule: {event.schedule_kind.replaceAll("_", " ")}{event.frequency ? ` · ${event.frequency.replaceAll("_", " ")}` : ""}</p>
            {event.frequency ? <p>Every {event.interval_count} interval(s)
              {event.weekdays?.length ? ` · ${event.weekdays.map(day => weekdays[day]).join(", ")}` : ""}
              {event.weekday !== null ? ` · ${weekdays[event.weekday]}` : ""}
              {event.month_ordinals?.length ? ` · ${event.month_ordinals.map(weekName).join(", ")} week(s)` : ""}
              {event.month_ordinal !== null ? ` · ${weekName(event.month_ordinal)} week` : ""}
              {event.day_of_month !== null ? ` · day ${event.day_of_month}` : ""}
              {event.month_of_year !== null ? ` · month ${event.month_of_year}` : ""}</p> : null}
            {event.dates.length ? <p>Selected dates: {event.dates.join(", ")}</p> : null}
            <p>Location: {event.location_type} · Expected attendance: {event.estimated_attendance}</p>
            {event.offsite_location ? <p>Offsite location: {event.offsite_location}</p> : null}
            {event.virtual_url ? <p className="break-all">Online meeting link: {event.virtual_url}</p> : null}
            <p>Scope: {event.scope} · Visibility: {event.visibility} · Protection requested: {event.protection}</p>
            <p>Food or drinks: {event.food_drinks_planned ? "Yes" : "No"} · Setup: {event.setup_minutes} minutes · Cleanup: {event.cleanup_minutes} minutes</p>
            {event.public_contact_name || event.public_contact_email ? <p>Public contact: {event.public_contact_name} {event.public_contact_email}</p> : null}
            {event.description ? <p className="whitespace-pre-wrap">Description: {event.description}</p> : null}
            {event.public_description ? <p className="whitespace-pre-wrap">Public description: {event.public_description}</p> : null}
            {event.requester_notes ? <p className="whitespace-pre-wrap">Private notes: {event.requester_notes}</p> : null}
            <p>Rooms requested: {event.rooms.join(", ") || "None"}</p>
            <p>Co-sponsoring ministries: {event.ministries.join(", ") || "None"}</p>
            <p>Resources requested: {event.resources.map(resource => `${resource.name} (${resource.quantity})${resource.notes ? `: ${resource.notes}` : ""}`).join(", ") || "None"}</p>
          </div>
        </details>
      </li>)}</ul> : <p>No events were submitted.</p>}
      {plan.status === "submitted" ? <details><summary>Request changes</summary><form action={requestCalendarChanges} className="mt-3 space-y-3">
        <input type="hidden" name="plan" value={plan.id} />
        <label className="block">What needs to change? <textarea name="reason" required maxLength={2000} className="block w-full rounded border border-input bg-background p-2" /></label>
        <Button type="submit">Request changes</Button>
      </form></details> : null}
    </li>)}</ol>
  </div>;
}
