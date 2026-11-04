import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/guards";
import { formatInstant } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveConflictDecision, saveConflictPolicy } from "./actions";

export const metadata: Metadata = { title: "Conflict Center" };
type Detail = { event?: string; ministry?: string; other_event?: string; other_ministry?: string; room?: string; resource?: string;
  reservation?: string; attendance?: number; capacity?: number; threshold?: number; confirmed?: number; provisional?: number;
  participants?: { event_id: string; title: string; ministry: string }[] };
const labels: Record<string, string> = {
  room_planning: "Room requested by more than one event", exclusive_planning: "Exclusive on-site events overlap",
  same_ministry: "Events from the same ministry overlap", church_wide_overlap: "Church-wide events overlap",
  room_reservation: "Room has an existing reservation", room_unavailable: "Room is unavailable",
  food_policy: "Food is not allowed in this room", room_capacity: "Attendance exceeds room capacity",
  large_event: "Large attendance", resource_unavailable: "Resource is unavailable",
  resource_capacity: "Confirmed resource capacity is insufficient", resource_planning: "Provisional resource demand exceeds capacity",
};

export default async function ConflictCenter({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, policy, canManage] = await Promise.all([
    supabase.rpc("calendar_list_conflicts"), supabase.rpc("calendar_conflict_policy_get"), hasPermission("churchCalendar.manage"),
  ]);
  const conflicts = data ?? [];
  return <div className="space-y-6">
    <PageHeader title="Conflict Center" description="Review submitted planning requests. Decisions do not approve events or reserve rooms or resources." />
    <Link className="underline" href="/admin/calendar-submissions">Back to calendar plans</Link>
    {params.updated ? <p role="status">{params.updated === "policy" ? "Attendance threshold saved." : "Decision recorded for this conflict."}</p> : null}
    {params.error || error || policy.error ? <p role="alert">The request could not be completed. A conflict may have changed; refresh and try again.</p> : null}
    {canManage && policy.data?.[0] ? <form action={saveConflictPolicy} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <label className="flex flex-col gap-1 text-sm font-medium">Large-event warning threshold
        <input className="rounded border bg-background p-2" type="number" name="threshold" min={1} max={100000} defaultValue={policy.data[0].large_event_threshold} required />
      </label><Button type="submit" variant="outline">Save threshold</Button>
    </form> : null}
    <p className="text-sm text-muted-foreground">Exclusive requests apply to on-site church events across the property, including setup and cleanup. Offsite and online events are outside this rule.</p>
    {!error && !conflicts.length ? <p>No current conflicts or warnings.</p> : null}
    <ol className="space-y-4">{conflicts.map(conflict => {
      const d = conflict.details as Detail;
      const people = d.participants?.length ? d.participants : [
        { event_id: conflict.event_id, title: d.event ?? "Event", ministry: d.ministry ?? "" },
        ...(conflict.other_event_id ? [{ event_id: conflict.other_event_id, title: d.other_event ?? "Other event", ministry: d.other_ministry ?? "" }] : []),
      ];
      const options = Array.from(new Map(people.map(person => [person.event_id, person])).values());
      return <li key={conflict.fingerprint} className="space-y-3 rounded-xl border bg-card p-4">
        <div><p className="text-sm font-semibold uppercase">{conflict.classification === "hard" ? "Hard block" : conflict.classification === "planning" ? "Planning decision required" : "Warning"}</p>
          <h2 className="text-lg font-semibold">{labels[conflict.conflict_type] ?? "Calendar conflict"}</h2></div>
        <p>{d.event} {d.ministry ? `· ${d.ministry}` : ""}{d.other_event ? ` / ${d.other_event}${d.other_ministry ? ` · ${d.other_ministry}` : ""}` : ""}</p>
        <p>{formatInstant(conflict.starts_at, conflict.timezone)} – {formatInstant(conflict.ends_at, conflict.timezone)} ({conflict.timezone})</p>
        {d.room ? <p>Room: {d.room}{d.reservation ? ` · Reservation ${d.reservation}` : ""}</p> : null}
        {d.resource ? <p>Resource: {d.resource}{d.capacity !== undefined ? ` · Capacity ${d.capacity} · Confirmed ${d.confirmed} · Provisional ${d.provisional}` : ""}</p> : null}
        {d.attendance !== undefined ? <p>Attendance: {d.attendance}{d.capacity !== undefined ? ` · Room capacity: ${d.capacity}` : ""}{d.threshold !== undefined ? ` · Threshold: ${d.threshold}` : ""}</p> : null}
        {conflict.classification === "hard" ? <p>Correct the underlying issue before this event can proceed. This block cannot be overridden here.</p> : <form action={saveConflictDecision} className="space-y-2 border-t pt-3">
          <input type="hidden" name="fingerprint" value={conflict.fingerprint} />
          <label className="block text-sm font-medium">{conflict.classification === "planning" ? "Event selected to advance" : "Event acknowledged"}
            <select name="selected" defaultValue={conflict.selected_event_id ?? ""} required className="mt-1 block w-full rounded border bg-background p-2">
              <option value="" disabled>Select an event</option>{options.map(person => <option key={person.event_id} value={person.event_id}>{person.title}{person.ministry ? ` · ${person.ministry}` : ""}</option>)}
            </select></label>
          <label className="block text-sm font-medium">Reason<textarea name="reason" minLength={3} maxLength={1000} required defaultValue={conflict.reason ?? ""} className="mt-1 block w-full rounded border bg-background p-2" /></label>
          <Button type="submit" variant="outline">{conflict.selected_event_id ? "Update decision" : "Record decision"}</Button>
          {conflict.selected_event_id ? <p className="text-sm">A decision is recorded for the current details. Changes may require a new decision.</p> : null}
        </form>}
      </li>;
    })}</ol>
  </div>;
}
