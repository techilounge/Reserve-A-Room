import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CalendarApprovalControl, CalendarCancellationControl } from "@/components/admin/calendar-event-controls";
import { PHASE6_APPROVAL_UI_ENABLED } from "@/lib/calendar-planning/phase6-gate";

import { requestCalendarChanges } from "./actions";

export const metadata: Metadata = { title: "Church Calendar Plans" };
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekName = (week: number) => ({ "-1": "last", "1": "first", "2": "second", "3": "third", "4": "fourth" })[String(week)] ?? String(week);
type Plan = { id: string; cycle: string; ministry: string; status: string; revision: number; submitted_at: string;
  message: string | null; events: { id: string; event_id: string; reference: string; title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; all_day: boolean;
    timezone: string; schedule_kind: string; frequency: string | null; description: string | null; public_description: string | null;
    interval_count: number | null; weekdays: number[] | null; weekday: number | null; month_ordinals: number[] | null;
    month_ordinal: number | null; day_of_month: number | null; month_of_year: number | null;
    location_type: string; offsite_location: string | null; virtual_url: string | null; scope: string; protection: string;
    visibility: string; food_drinks_planned: boolean; setup_minutes: number; cleanup_minutes: number;
    public_contact_name: string | null; public_contact_email: string | null; estimated_attendance: number; requester_notes: string | null; rooms: string[]; ministries: string[];
    dates: { id: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null }[]; resources: { name: string; quantity: number; notes: string | null }[] }[] };

export default async function CalendarSubmissions({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("calendar_staff_plan_list");
  const activeResult = PHASE6_APPROVAL_UI_ENABLED ? await supabase.rpc("calendar_staff_active_commitments") : null;
  const latestResult = PHASE6_APPROVAL_UI_ENABLED ? await supabase.rpc("calendar_staff_latest_commitments") : null;
  const activeCommitments = activeResult?.data ?? [];
  const latestCommitments = latestResult?.data ?? [];
  const plans = (data ?? []) as Plan[];
  const errorMessage = params.error === "schedule" ? "Approval requires same-day, on-grid times within public booking hours, including setup and cleanup."
    : params.error === "past" ? "Approval needs at least one future date. Past dates must match the existing approval, and an in-progress date cannot be changed."
    : params.error === "contact" ? "Enter a contact name and phone number with country code."
    : params.error === "approval" ? "The event could not be approved. Resolve current conflicts, check the submission and room rules, then try again."
    : params.error === "cancel" ? "The event could not be cancelled. Refresh the page and check that no occurrence is in progress."
    : "Unable to complete the request. Check the cycle and try again.";
  return <div className="space-y-6">
    <PageHeader title="Church Calendar Plans" description={PHASE6_APPROVAL_UI_ENABLED ? "Review submitted plans and their approved commitments." : "Submitted ministry plans are proposals; no room or resource has been reserved."} />
    {params.updated ? <p role="status">{params.updated === "approval" ? "The event approval was recorded." : params.updated === "cancel" ? "The event was cancelled and future commitments were released." : "The planner can now revise this plan while its cycle is open."}</p> : null}
    {params.error || error || activeResult?.error || latestResult?.error ? <p role="alert">{errorMessage}</p> : null}
    {PHASE6_APPROVAL_UI_ENABLED && activeCommitments.length ? <section className="space-y-3"><h2 className="text-xl font-semibold">Approved events</h2>
      <ul className="space-y-2">{activeCommitments.map(commitment => <li key={commitment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div><p className="font-semibold">{commitment.title}</p><p className="text-sm text-muted-foreground">{commitment.ministry} · {commitment.cycle}{commitment.plan_active ? "" : " · Ministry removed from planning"}</p></div>
        <div className="flex flex-wrap items-center gap-3"><Link className="underline" href={`/admin/calendar-submissions/occurrences/${commitment.submission_id}`}>View approved dates</Link>
          <CalendarCancellationControl eventId={commitment.event_id} commitmentId={commitment.id} title={commitment.title} /></div>
      </li>)}</ul></section> : null}
    {!error && !plans.length ? <p>No submitted plans yet.</p> : null}
    <ol className="space-y-4">{plans.map(plan => <li key={plan.id} className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">{plan.ministry} · {plan.cycle}</h2>
      <p>Submission {plan.revision} · {plan.status.replaceAll("_", " ")}</p>
      {plan.message ? <p className="whitespace-pre-wrap">{plan.message}</p> : null}
      {plan.events.length ? <ul className="space-y-2">{plan.events.map(event => { const commitment=activeCommitments.find(c => c.event_id===event.event_id); const latest=latestCommitments.find(c => c.event_id===event.event_id); return <li key={event.reference}>
        <details className="rounded border p-3"><summary>{event.title} · {event.reference}</summary>
          <div className="mt-2 space-y-2 text-sm">
            <p>{event.start_date} to {event.end_date} · {event.all_day ? "All day" : event.schedule_kind === "specific_dates" ? "Times listed below" : `${event.start_time}–${event.end_time}`} ({event.timezone})</p>
            <p>Schedule: {event.schedule_kind.replaceAll("_", " ")}{event.frequency ? ` · ${event.frequency.replaceAll("_", " ")}` : ""}</p>
            {event.frequency ? <p>Every {event.interval_count} interval(s)
              {event.weekdays?.length ? ` · ${event.weekdays.map(day => weekdays[day]).join(", ")}` : ""}
              {event.weekday !== null ? ` · ${weekdays[event.weekday]}` : ""}
              {event.month_ordinals?.length ? ` · ${event.month_ordinals.map(weekName).join(", ")} week(s)` : ""}
              {event.month_ordinal !== null ? ` · ${weekName(event.month_ordinal)} week` : ""}
              {event.day_of_month !== null ? ` · day ${event.day_of_month}` : ""}
              {event.month_of_year !== null ? ` · month ${event.month_of_year}` : ""}</p> : null}
            {event.dates.length ? <div><p>Selected dates:</p><ul className="list-inside list-disc">{event.dates.map(date => <li key={date.id}>{date.start_date} to {date.end_date} · {event.all_day ? "All day" : `${date.start_time}–${date.end_time}`}</li>)}</ul></div> : null}
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
            <Link className="underline" href={`/admin/calendar-submissions/occurrences/${event.id}`}>View submitted dates and requests</Link>
            {PHASE6_APPROVAL_UI_ENABLED ? <div className="pt-2">{commitment?.submission_id===event.id ? <p>Approved with confirmed commitments.</p> : latest?.submission_id===event.id && latest.state==="cancelled" ? <p>Cancelled. Request changes and submit a fresh revision to seek approval again.</p> :
              plan.status === "submitted" ? <CalendarApprovalControl eventId={event.event_id} revision={plan.revision} commitmentId={commitment?.id} /> : <p>This submission cannot be approved while changes are being prepared.</p>}</div> : null}
          </div>
        </details>
      </li>; })}</ul> : <p>No events were submitted.</p>}
      {plan.status === "submitted" ? <details><summary>Request changes</summary><form action={requestCalendarChanges} className="mt-3 space-y-3">
        <input type="hidden" name="plan" value={plan.id} />
        <label className="block">What needs to change? <textarea name="reason" required maxLength={2000} className="block w-full rounded border border-input bg-background p-2" /></label>
        <Button type="submit">Request changes</Button>
      </form></details> : null}
    </li>)}</ol>
  </div>;
}
