"use client";

import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

import { duplicatePlannerDraft, removePlannerDraft, savePlannerDraft } from "./actions";

type Option = { id: string; name: string; active: boolean };
type Schedule = { kind: string; timezone: string; start_date: string | null; end_date: string | null; start_time: string | null; end_time: string | null;
  frequency: string | null; interval_count: number | null; weekdays: number[] | null; weekday: number | null;
  month_ordinals: number[] | null; month_ordinal: number | null; day_of_month: number | null; month_of_year: number | null };
export type PlannerEvent = { id: string; title: string; reference_code: string; description: string | null; public_description: string | null;
  category: string; scope: string; protection: string; visibility: string; location_type: string; offsite_location: string | null;
  virtual_url: string | null; estimated_attendance: number; food_drinks_planned: boolean; setup_minutes: number; cleanup_minutes: number;
  public_contact_name: string | null; public_contact_email: string | null; requester_notes: string | null; revision: number; draft_version: number;
  schedule: Schedule; dates: string[]; rooms: string[]; ministries: string[]; resources: { id: string; quantity: number; notes: string | null }[] };
export type PlannerCatalog = { rooms: Option[]; ministries: Option[]; resources: Option[] };

const field = "block w-full rounded border border-input bg-background p-2";
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ordinals = [[1, "First"], [2, "Second"], [3, "Third"], [4, "Fourth"], [-1, "Last"]] as const;

export function EventForm({ plan, timezone, catalog, event }: { plan: string; timezone: string; catalog: PlannerCatalog; event?: PlannerEvent }) {
  const s = event?.schedule;
  const [kind, setKind] = useState(s?.kind ?? "one_time");
  const [frequency, setFrequency] = useState(s?.frequency ?? "daily");
  const [state, action, pending] = useActionState(savePlannerDraft, { error: "" });
  const [, startTransition] = useTransition();
  return <div className="space-y-3 rounded-lg border p-4">
    <form action={action} onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      startTransition(() => action(values));
    }} className="space-y-4">
      <input type="hidden" name="plan" value={plan} /><input type="hidden" name="event" value={event?.id ?? ""} />
      <input type="hidden" name="draft_version" value={event?.draft_version ?? ""} />
      <input type="hidden" name="timezone" value={timezone} />
      <label className="block">Event title <input className={field} name="title" maxLength={200} defaultValue={event?.title} required /></label>
      <label className="block">Description <textarea className={field} name="description" maxLength={5000} defaultValue={event?.description ?? ""} /></label>
      <label className="block">Public description <textarea className={field} name="public_description" maxLength={5000} defaultValue={event?.public_description ?? ""} /></label>
      <label className="block">Category <input className={field} name="category" defaultValue={event?.category ?? "other"} maxLength={100} required /></label>
      <label className="block">Scope <select className={field} name="scope" defaultValue={event?.scope ?? "ministry"}><option value="ministry">Ministry</option><option value="church_wide">Church-wide</option><option value="administrative">Administrative</option><option value="community">Community</option></select></label>
      <label className="block">Visibility <select className={field} name="visibility" defaultValue={event?.visibility ?? "internal"}><option value="internal">Internal</option><option value="public">Public if approved</option></select></label>
      <label className="block">Schedule protection request <select className={field} name="protection" defaultValue={event?.protection ?? "normal"}><option value="normal">Normal</option><option value="exclusive">Request exclusivity</option></select></label>
      <label className="block">Location <select className={field} name="location_type" defaultValue={event?.location_type ?? "church"}><option value="church">Church</option><option value="offsite">Offsite</option><option value="virtual">Online</option><option value="tbd">To be determined</option></select></label>
      <label className="block">Offsite location, if applicable <input className={field} name="offsite_location" maxLength={500} defaultValue={event?.offsite_location ?? ""} /></label>
      <label className="block">Online meeting link, if applicable <input className={field} name="virtual_url" type="url" maxLength={2000} defaultValue={event?.virtual_url ?? ""} /></label>
      <label className="block">Estimated attendance <input className={field} name="estimated_attendance" type="number" min={1} max={100000} defaultValue={event?.estimated_attendance ?? 1} required /></label>
      <label className="flex gap-2"><input type="checkbox" name="food_drinks_planned" defaultChecked={event?.food_drinks_planned} /> Food or drinks planned</label>
      <label className="block">Setup minutes <input className={field} name="setup_minutes" type="number" min={0} max={1440} defaultValue={event?.setup_minutes ?? 0} /></label>
      <label className="block">Cleanup minutes <input className={field} name="cleanup_minutes" type="number" min={0} max={1440} defaultValue={event?.cleanup_minutes ?? 0} /></label>
      <label className="block">Public contact name <input className={field} name="public_contact_name" maxLength={120} defaultValue={event?.public_contact_name ?? ""} /></label>
      <label className="block">Public contact email <input className={field} name="public_contact_email" type="email" defaultValue={event?.public_contact_email ?? ""} /></label>
      <label className="block">Private notes for the church office <textarea className={field} name="requester_notes" maxLength={5000} defaultValue={event?.requester_notes ?? ""} /></label>
      <fieldset className="space-y-3 rounded border p-3"><legend className="font-semibold">Schedule ({timezone})</legend>
        <label className="block">Schedule type <select className={field} name="kind" value={kind} onChange={e => setKind(e.target.value)}><option value="one_time">One day</option><option value="multi_day">Multiple consecutive days</option><option value="specific_dates">Selected dates</option><option value="recurring">Repeating schedule</option></select></label>
        <p className="text-sm text-muted-foreground">You can save an incomplete schedule and return later. Complete it before submitting your plan.</p>
        <label className="block">Start date <input className={field} type="date" name="start_date" defaultValue={s?.start_date ?? ""} /></label>
        <label className="block">End date (same as start for one day) <input className={field} type="date" name="end_date" defaultValue={s?.end_date ?? ""} /></label>
        <label className="block">Start time <input className={field} type="time" name="start_time" defaultValue={s?.start_time ?? ""} /></label>
        <label className="block">End time <input className={field} type="time" name="end_time" defaultValue={s?.end_time ?? ""} /></label>
        <label className={kind === "specific_dates" ? "block" : "hidden"}>For selected dates: enter dates as YYYY-MM-DD, separated by commas <textarea className={field} name="dates" defaultValue={event?.dates.join(", ") ?? ""} /></label>
        <div hidden={kind !== "recurring"} className="space-y-3"><label className="block">Frequency <select className={field} name="frequency" value={frequency} onChange={e => setFrequency(e.target.value)}>
          <option value="daily">Every number of days</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly_day">Monthly by date</option><option value="monthly_nth_weekday">Monthly by week and weekday</option><option value="yearly_date">Yearly by date</option><option value="yearly_nth_weekday">Yearly by week and weekday</option>
        </select></label>
        <label className="block">Repeat interval <input className={field} name="interval_count" type="number" min={1} max={365} defaultValue={s?.interval_count ?? 1} /></label>
        <fieldset hidden={frequency !== "weekly"}><legend>Days for a weekly schedule</legend>{weekdays.map((day, i) => <label key={day} className="mr-3 inline-flex gap-1"><input type="checkbox" name="weekdays" value={i} defaultChecked={s?.weekdays?.includes(i)} />{day}</label>)}</fieldset>
        <label className={["monthly_nth_weekday", "yearly_nth_weekday"].includes(frequency) ? "block" : "hidden"}>Weekday <select className={field} name="weekday" defaultValue={s?.weekday ?? 0}>{weekdays.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>
        <fieldset hidden={frequency !== "monthly_nth_weekday"}><legend>Weeks of month</legend>{ordinals.map(([i, label]) => <label key={i} className="mr-3 inline-flex gap-1"><input type="checkbox" name="month_ordinals" value={i} defaultChecked={s?.month_ordinals?.includes(i)} />{label}</label>)}</fieldset>
        <label className={frequency === "yearly_nth_weekday" ? "block" : "hidden"}>Week of month <select className={field} name="month_ordinal" defaultValue={s?.month_ordinal ?? 1}>{ordinals.map(([i, label]) => <option key={i} value={i}>{label}</option>)}</select></label>
        <label className={["monthly_day", "yearly_date"].includes(frequency) ? "block" : "hidden"}>Day of month <input className={field} name="day_of_month" type="number" min={1} max={31} defaultValue={s?.day_of_month ?? 1} /></label>
        <label className={["yearly_date", "yearly_nth_weekday"].includes(frequency) ? "block" : "hidden"}>Month <input className={field} name="month_of_year" type="number" min={1} max={12} defaultValue={s?.month_of_year ?? 1} /></label>
        </div>
      </fieldset>
      <fieldset><legend className="font-semibold">Requested rooms</legend>{catalog.rooms.filter(room => room.active || event?.rooms.includes(room.id)).map(room => <label key={room.id} className="flex gap-2"><input type="checkbox" name="rooms" value={room.id} defaultChecked={event?.rooms.includes(room.id)} />{room.name}{!room.active ? " (unavailable — remove before saving)" : ""}</label>)}</fieldset>
      <fieldset><legend className="font-semibold">Co-sponsoring ministries</legend>{catalog.ministries.filter(ministry => ministry.active || event?.ministries.includes(ministry.id)).map(ministry => <label key={ministry.id} className="flex gap-2"><input type="checkbox" name="ministries" value={ministry.id} defaultChecked={event?.ministries.includes(ministry.id)} />{ministry.name}{!ministry.active ? " (unavailable — remove before saving)" : ""}</label>)}</fieldset>
      <fieldset className="space-y-2"><legend className="font-semibold">Requested resources</legend>{catalog.resources.filter(resource => resource.active || event?.resources.some(r => r.id === resource.id)).map(resource => {
        const saved = event?.resources.find(r => r.id === resource.id);
        return <div key={resource.id} className="rounded border p-2"><label className="flex gap-2"><input type="checkbox" name="resources" value={resource.id} defaultChecked={!!saved} />{resource.name}{!resource.active ? " (unavailable — remove before saving)" : ""}</label>
          <label className="block">Quantity <input className={field} name={`resource_quantity_${resource.id}`} type="number" min={1} max={100000} defaultValue={saved?.quantity ?? 1} /></label>
          <label className="block">Resource notes <input className={field} name={`resource_notes_${resource.id}`} maxLength={1000} defaultValue={saved?.notes ?? ""} /></label></div>;
      })}</fieldset>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save event"}</Button>
    </form>
    {event ? <form action={duplicatePlannerDraft}><input type="hidden" name="plan" value={plan} /><input type="hidden" name="event" value={event.id} /><Button variant="outline" type="submit">Duplicate event</Button></form> : null}
    {event && event.revision === 0 ? <ConfirmationDialog
      trigger={<Button variant="outline" type="button">Delete draft</Button>}
      title="Delete this draft?" description="This removes the draft event from your plan."
      confirmLabel="Delete draft" destructive onConfirm={async () => {
        const values = new FormData(); values.set("plan", plan); values.set("event", event.id);
        await removePlannerDraft(values);
      }} /> : null}
  </div>;
}
