import type { Metadata } from "next";

import { CalendarConfirmButton } from "@/components/admin/calendar-confirm-button";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasPermission } from "@/lib/auth/guards";
import { formatInstant, toLocalParts } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { addMinistry, invitePlanner, revokePlanner, rotatePlanner, saveCycle, saveResource, transitionCycle } from "./actions";

export const metadata: Metadata = { title: "Church Calendar" };
const selectStyle = "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";
const field = "flex flex-col gap-1 text-sm font-medium";
const card = "space-y-4 rounded-xl border bg-card p-4 sm:p-5";
const localInstant = (value: string) => {
  const parts = toLocalParts(value, "America/Chicago");
  return `${parts.date}T${parts.time}`;
};

function CycleForm({ cycle }: { cycle?: {
  id: string; name: string; start_date: string; end_date: string; submission_opens_at: string;
  submission_deadline: string; instructions: string | null;
} }) {
  return <form action={saveCycle} className="grid gap-3 sm:grid-cols-2">
    {cycle ? <input type="hidden" name="id" value={cycle.id} /> : null}
    <label className={field}>Cycle name<Input name="name" defaultValue={cycle?.name} required maxLength={150} /></label>
    <label className={field}>Calendar start<Input name="start" type="date" defaultValue={cycle?.start_date} required /></label>
    <label className={field}>Calendar end<Input name="end" type="date" defaultValue={cycle?.end_date} required /></label>
    <label className={field}>Planning opens (Central time)<Input name="opens" type="datetime-local" defaultValue={cycle ? localInstant(cycle.submission_opens_at) : undefined} required /></label>
    <label className={field}>Planning deadline (Central time)<Input name="deadline" type="datetime-local" defaultValue={cycle ? localInstant(cycle.submission_deadline) : undefined} required /></label>
    <label className={`${field} sm:col-span-2`}>Instructions<textarea name="instructions" defaultValue={cycle?.instructions ?? ""} maxLength={5000} rows={3} className={selectStyle} /></label>
    <div className="sm:col-span-2"><Button type="submit">{cycle ? "Save cycle" : "Create draft cycle"}</Button></div>
  </form>;
}

function ResourceForm({ resource }: { resource?: { id: string; name: string; category: string;
  available_quantity: number; active: boolean; description: string | null; private_notes: string | null } }) {
  return <form action={saveResource} className="grid gap-3 sm:grid-cols-2">
    {resource ? <input type="hidden" name="id" value={resource.id} /> : null}
    <label className={field}>Resource name<Input name="name" defaultValue={resource?.name} required maxLength={120} /></label>
    <label className={field}>Category<select name="category" defaultValue={resource?.category ?? "equipment"} className={selectStyle}>
      <option value="equipment">Equipment</option><option value="facility">Facility</option><option value="vehicle">Vehicle</option>
      <option value="service">Service</option><option value="staff_support">Staff support</option><option value="other">Other</option>
    </select></label>
    <label className={field}>Quantity<Input name="quantity" type="number" min={1} step={1} defaultValue={resource?.available_quantity ?? 1} required /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={resource?.active ?? true} className="size-4" />Active</label>
    <label className={`${field} sm:col-span-2`}>Description<textarea name="description" defaultValue={resource?.description ?? ""} maxLength={2000} className={selectStyle} /></label>
    <label className={`${field} sm:col-span-2`}>Private staff notes<textarea name="notes" defaultValue={resource?.private_notes ?? ""} maxLength={2000} className={selectStyle} /></label>
    <div className="sm:col-span-2"><Button type="submit">{resource ? "Save resource" : "Add resource"}</Button></div>
  </form>;
}

export default async function ChurchCalendarPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  // Layouts and pages may render in parallel; do not rely on the layout's guard alone.
  if (!(await hasPermission("churchCalendar.manage"))) return null;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [cyclesResult, plansResult, grantsResult, resourcesResult, ministriesResult, deliveriesResult] = await Promise.all([
    supabase.from("calendar_cycles").select("*").order("created_at", { ascending: false }),
    supabase.from("ministry_calendar_plans").select("*").order("created_at"),
    supabase.from("calendar_plan_access").select("id, plan_id, contact_name, contact_email, contact_phone, label, version, expires_at, revoked_at, created_at"),
    supabase.from("calendar_resources").select("*").order("name"),
    supabase.rpc("admin_list_ministries"),
    supabase.rpc("calendar_invitation_delivery_status"),
  ]);
  if (cyclesResult.error || plansResult.error || grantsResult.error || resourcesResult.error || ministriesResult.error || deliveriesResult.error) {
    return <div className="space-y-4"><PageHeader title="Church Calendar" />
      <p role="alert">Calendar configuration is unavailable. Confirm the Phase 1 database migration has been applied to this environment.</p></div>;
  }
  const cycles = cyclesResult.data; const plans = plansResult.data; const grants = grantsResult.data;
  const resources = resourcesResult.data; const ministries = ministriesResult.data;
  return <div className="space-y-6">
    <PageHeader title="Church Calendar" description="Manage planning cycles, ministry invitations, and the resource catalog." />
    {query.message ? <p role="status" className="rounded-lg border border-green-600 p-3">{query.message}</p> : null}
    {query.error ? <p role="alert" className="rounded-lg border border-destructive p-3">{query.error}</p> : null}
    <section className={card} aria-labelledby="new-cycle"><h2 id="new-cycle" className="text-xl font-semibold">Create a planning cycle</h2>
      <p className="text-sm text-muted-foreground">A cycle can span up to three years. Dates and deadlines use Central time.</p><CycleForm /></section>
    <section className="space-y-4" aria-labelledby="cycles"><h2 id="cycles" className="text-xl font-semibold">Planning cycles</h2>
      {cycles.length === 0 ? <p>No planning cycles yet.</p> : null}
      {cycles.map((cycle) => {
        const editable = cycle.status === "draft" || cycle.status === "open";
        const cyclePlans = plans.filter((plan) => plan.cycle_id === cycle.id);
        return <article key={cycle.id} className={card}>
          <div><h3 className="text-lg font-semibold">{cycle.name}</h3><p className="text-sm text-muted-foreground">Status: {cycle.status} · Deadline: {formatInstant(cycle.submission_deadline, "America/Chicago")}</p></div>
          {editable ? <details><summary className="cursor-pointer font-medium">Edit cycle</summary><div className="pt-4"><CycleForm cycle={cycle} /></div></details> : null}
          <div className="flex flex-wrap gap-3">
            {cycle.status === "draft" ? <form action={transitionCycle}><input type="hidden" name="id" value={cycle.id} /><input type="hidden" name="status" value="open" /><Button type="submit">Open cycle</Button></form> : null}
            {cycle.status === "open" ? <form id={`review-${cycle.id}`} action={transitionCycle}><input type="hidden" name="id" value={cycle.id} /><input type="hidden" name="status" value="review" /><CalendarConfirmButton formId={`review-${cycle.id}`} label="Move to review" description="Planners will no longer be able to open this cycle until it is reopened." /></form> : null}
            {cycle.status === "review" ? <form id={`finalize-${cycle.id}`} action={transitionCycle}><input type="hidden" name="id" value={cycle.id} /><input type="hidden" name="status" value="finalized" /><CalendarConfirmButton formId={`finalize-${cycle.id}`} label="Finalize" description="This cycle will remain closed for planning unless a Super Admin reopens it with a reason." /></form> : null}
            {cycle.status !== "archived" ? <form id={`archive-${cycle.id}`} action={transitionCycle}><input type="hidden" name="id" value={cycle.id} /><input type="hidden" name="status" value="archived" /><CalendarConfirmButton formId={`archive-${cycle.id}`} label="Archive" description="This closes the cycle and its planning access. Archived cycles cannot be reopened in this phase." /></form> : null}
          </div>
          {cycle.status === "review" || cycle.status === "finalized" ? <form action={transitionCycle} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="id" value={cycle.id} /><input type="hidden" name="status" value="open" />
            <label className={`${field} flex-1`}>Reason for reopening<Input name="reason" minLength={3} maxLength={500} required /></label><Button type="submit" variant="outline">Reopen cycle</Button>
          </form> : null}
          {editable ? <form action={addMinistry} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="cycle" value={cycle.id} />
            <label className={`${field} flex-1`}>Participating ministry<select name="ministry" className={selectStyle} required defaultValue=""><option value="" disabled>Choose a ministry</option>
              {ministries.filter((m) => m.active && !cyclePlans.some((p) => p.ministry_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <Button type="submit" variant="secondary">Add ministry</Button>
          </form> : null}
          {cyclePlans.map((plan) => {
            const ministry = ministries.find((m) => m.id === plan.ministry_id);
            return <div key={plan.id} className="space-y-3 rounded-lg border p-4">
              <h4 className="font-semibold">{ministry?.name ?? "Ministry"}</h4>
              {grants.filter((grant) => grant.plan_id === plan.id).map((grant) => {
                const active = !grant.revoked_at && new Date(grant.expires_at).getTime() > Date.now();
                const delivery = deliveriesResult.data.find((item) => item.grant_id === grant.id);
                return <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div><p className="font-medium">{grant.contact_name} · {grant.label}</p><p className="text-sm text-muted-foreground">{grant.contact_email} · {active ? "Active" : grant.revoked_at ? "Revoked" : "Expired"}</p>
                    <p className="text-sm text-muted-foreground">Email: {delivery?.status ?? "unknown"}{delivery?.status === "failed" || delivery?.status === "skipped" ? " — Check email settings, then replace and resend." : ""}</p></div>
                  {active ? <div className="flex flex-wrap gap-2">
                    {editable ? <form id={`rotate-${grant.id}`} action={rotatePlanner}><input type="hidden" name="id" value={grant.id} /><input type="hidden" name="version" value={grant.version} /><CalendarConfirmButton formId={`rotate-${grant.id}`} label="Replace and resend" description="The previous invitation and this planner's existing sessions will stop working." small /></form> : null}
                    <form id={`revoke-${grant.id}`} action={revokePlanner}><input type="hidden" name="id" value={grant.id} /><CalendarConfirmButton formId={`revoke-${grant.id}`} label="Revoke" description="This planner's invitation and sessions will stop working. Other planners are unaffected." small /></form>
                  </div> : null}
                </div>;
              })}
              {editable ? <details><summary className="cursor-pointer text-sm font-medium">Invite a planner</summary>
                <form action={invitePlanner} className="grid gap-3 pt-3 sm:grid-cols-2"><input type="hidden" name="plan" value={plan.id} />
                  <label className={field}>Name<Input name="name" required maxLength={120} /></label>
                  <label className={field}>Email<Input name="email" type="email" required /></label>
                  <label className={field}>Phone (optional)<Input name="phone" maxLength={40} /></label>
                  <label className={field}>Planner role<select name="label" className={selectStyle}><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="additional">Additional</option></select></label>
                  <div className="sm:col-span-2"><Button type="submit">Queue invitation</Button></div>
                </form></details> : null}
            </div>;
          })}
        </article>;
      })}
    </section>
    <section className={card} aria-labelledby="resources"><h2 id="resources" className="text-xl font-semibold">Resource catalog</h2>
      <p className="text-sm text-muted-foreground">Configure resources for future planning. This catalog does not allocate resources or check availability.</p>
      <details><summary className="cursor-pointer font-medium">Add a resource</summary><div className="pt-4"><ResourceForm /></div></details>
      {resources.map((resource) => <details key={resource.id} className="border-t pt-3"><summary className="cursor-pointer font-medium">{resource.name} · {resource.active ? "Active" : "Archived"} · Quantity {resource.available_quantity}</summary><div className="pt-4"><ResourceForm resource={resource} /></div></details>)}
    </section>
  </div>;
}
