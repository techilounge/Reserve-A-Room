import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { hasPermission } from "@/lib/auth/guards";
import { formatInstant } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { queueDueReminders } from "./actions";

export const metadata: Metadata = { title: "Planning Dashboard" };
type Ministry = { id:string; ministry:string; submission_status:string; submission_revision:number; invited:boolean; events:number; approved:number; conflicts:number };
type Cycle = { id:string; name:string; status:string; submission_deadline:string; invited:number; submitted:number; outstanding:number;
  events:number; approved:number; changes_requested:number; hard_conflicts:number; planning_conflicts:number; warnings:number; ministries:Ministry[] };

export default async function PlanningDashboard({searchParams}:{searchParams:Promise<{reminders?:string}>}) {
  if (!(await hasPermission("calendar.view"))) return null;
  const params=await searchParams;
  const supabase=await createSupabaseServerClient();
  const [result,catalog,canManage]=await Promise.all([
    supabase.rpc("calendar_planning_dashboard"),loadCatalog(),hasPermission("churchCalendar.manage"),
  ]);
  const cycles=(result.data ?? []) as unknown as Cycle[];
  const timezone=catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  return <div className="space-y-6">
    <PageHeader title="Planning Dashboard" description="Track ministry plans and current calendar conflicts." />
    {params.reminders === "error" ? <p role="alert">Could not queue reminders. Try again later.</p> : /^\d+$/.test(params.reminders ?? "") ? <p role="status">{params.reminders} due reminder(s) queued for delivery.</p> : null}
    <nav aria-label="Planning actions" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <Link className="underline" href="/admin/calendar-submissions">Review submissions</Link>
      <Link className="underline" href="/admin/calendar-conflicts">View conflicts</Link>
      <Link className="underline" href="/admin/church-calendar">Open Church Calendar</Link>
      {canManage ? <Link className="underline" href="/admin/church-calendar/setup">Manage planning cycles</Link> : null}
    </nav>
    {canManage ? <form action={queueDueReminders}><Button type="submit" variant="outline">Queue due reminders</Button>
      <p className="mt-1 text-sm text-muted-foreground">Only currently due reminders are queued; repeated runs do not duplicate them.</p></form> : null}
    {result.error ? <p role="alert">Planning progress is unavailable. Check the database migration and try again.</p> : null}
    {!result.error && !cycles.length ? <p>No planning cycles yet.</p> : null}
    {cycles.map(cycle => <section key={cycle.id} aria-labelledby={`cycle-${cycle.id}`} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div><h2 id={`cycle-${cycle.id}`} className="text-xl font-semibold">{cycle.name}</h2><p className="text-sm text-muted-foreground">{cycle.status.replaceAll("_"," ")} · Deadline {formatInstant(cycle.submission_deadline,timezone)} ({timezone})</p></div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{([
        ["Ministries with active invitation",cycle.invited],["Submitted",cycle.submitted],["Outstanding",cycle.outstanding],
        ["Events in plans",cycle.events],["Approved events",cycle.approved],["Changes requested",cycle.changes_requested],
        ["Hard conflicts",cycle.hard_conflicts],["Planning conflicts",cycle.planning_conflicts],["Warnings",cycle.warnings],
      ] as const).map(([label,value]) => <div key={label} className="rounded-lg border p-3"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}</dl>
      <h3 className="font-semibold">Ministry progress</h3>
      {cycle.ministries.length ? <ul className="divide-y rounded-lg border">{cycle.ministries.map(plan => <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div><p className="font-medium">{plan.ministry}</p><p className="text-sm text-muted-foreground">{plan.submission_status.replaceAll("_"," ")} · {plan.invited ? "Planner invited" : "No active planner invitation"}</p></div>
        <p className="text-sm">{plan.events} events · {plan.approved} approved · {plan.conflicts} conflicts or warnings</p>
      </li>)}</ul> : <p className="text-sm">No ministries participate in this cycle.</p>}
    </section>)}
  </div>;
}
