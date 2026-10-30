import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { hashPlannerBearer } from "@/lib/calendar-planning/token";
import { formatInstant, formatLongDate, type LocalDate } from "@/lib/datetime";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { acceptPlannerPolicies, openPlannerInvitation, signOutPlanner, submitPlannerPlan } from "./actions";
import { EventForm, type PlannerCatalog, type PlannerEvent } from "./event-form";

export const metadata: Metadata = { title: "Church calendar invitation", robots: { index: false, follow: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Context = { contact_name: string; ministry_name: string; cycle_name: string; start_date: LocalDate;
  end_date: LocalDate; deadline: string; instructions: string | null; timezone: string };
type Policy = { enabled: boolean; accepted: boolean; privacy_version: string | null; terms_version: string | null };
type Portal = PlannerCatalog & { status: string; revision: number; changes_requested_reason: string | null; events: PlannerEvent[] };
function isReady(event: PlannerEvent) {
  const s = event.schedule;
  if (!s?.start_date || !s.end_date || !s.start_time || !s.end_time) return false;
  if (s.kind === "specific_dates" && !event.dates.length) return false;
  if (s.kind !== "recurring") return true;
  if (!s.interval_count) return false;
  if (s.frequency === "weekly") return !!s.weekdays?.length;
  if (s.frequency === "monthly_day") return !!s.day_of_month;
  if (s.frequency === "monthly_nth_weekday") return s.weekday !== null && !!s.month_ordinals?.length;
  if (s.frequency === "yearly_date") return !!s.day_of_month && !!s.month_of_year;
  if (s.frequency === "yearly_nth_weekday") return s.weekday !== null && s.month_ordinal !== null && !!s.month_of_year;
  return s.frequency === "daily" || s.frequency === "weekdays";
}

export default async function PlannerInvitationPage({ params, searchParams }: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ grant?: string; token?: string; error?: string; signedOut?: string; submitted?: string }>;
}) {
  const { planId } = await params;
  const search = await searchParams;
  const validPlan = UUID.test(planId);
  let context: Context | null = null;
  let policy: Policy | null = null;
  let portal: Portal | null = null;
  const session = (await cookies()).get("calendar_planner")?.value;
  if (validPlan && session && TOKEN.test(session) && !search.token) {
    const { data } = await createSupabaseServiceClient().rpc("calendar_planner_session_context", {
      p_plan_id: planId, p_session_hash: hashPlannerBearer(session),
    });
    context = data as Context | null;
    if (context) {
      const { data: policyData } = await createSupabaseServiceClient().rpc("calendar_planner_policy_status", {
        p_plan_id: planId, p_session_hash: hashPlannerBearer(session),
      });
      policy = policyData as Policy | null;
      if (policy?.enabled && policy.accepted) {
        const { data: portalData } = await createSupabaseServiceClient().rpc("calendar_planner_portal", {
          p_plan_id: planId, p_session_hash: hashPlannerBearer(session),
        });
        portal = portalData as Portal | null;
      }
    }
  }
  const invitation = validPlan && search.grant && UUID.test(search.grant) && search.token && TOKEN.test(search.token);
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-5 py-12">
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stonehill · Church calendar</p>
      {invitation ? <>
        <h1 className="text-3xl font-semibold">Open your planning invitation</h1>
        <p>This private invitation is for you. Continue to verify the link and open your planning access.</p>
        <form action={openPlannerInvitation}>
          <input type="hidden" name="plan" value={planId} />
          <input type="hidden" name="grant" value={search.grant} />
          <input type="hidden" name="token" value={search.token} />
          <Button type="submit">Continue</Button>
        </form>
      </> : context ? <>
        <h1 className="text-3xl font-semibold">{context.cycle_name}</h1>
        <p>Welcome, {context.contact_name}. Your access is for <strong>{context.ministry_name}</strong>.</p>
        <p>Calendar dates: {formatLongDate(context.start_date)} – {formatLongDate(context.end_date)}.</p>
        <p>Planning deadline: {formatInstant(context.deadline, context.timezone)} ({context.timezone}).</p>
        {context.instructions ? <p className="whitespace-pre-wrap">{context.instructions}</p> : null}
        {!policy?.enabled ? <p className="text-muted-foreground">The church office will share the planning form when it is ready.</p> :
          !policy.accepted ? <form action={acceptPlannerPolicies} className="space-y-4">
            <p>Before planning, please read the current <Link className="underline" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link> and <Link className="underline" href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>.</p>
            <input type="hidden" name="plan" value={planId} />
            <input type="hidden" name="privacyVersion" value={policy.privacy_version ?? ""} />
            <input type="hidden" name="termsVersion" value={policy.terms_version ?? ""} />
            <label className="flex gap-2"><input type="checkbox" name="accept" value="yes" required /> I agree to the Privacy Policy and Terms of Service.</label>
            <Button type="submit">Continue to planning</Button>
          </form> : portal ? <section className="space-y-4" aria-label="Your calendar plan">
            <p>Requests are proposals; rooms and resources are not reserved until approved.</p>
            <p>Plan status: {portal.status.replaceAll("_", " ")} {portal.revision ? `(submission ${portal.revision})` : ""}</p>
            <p>{portal.events.length} event(s) · {portal.events.filter(isReady).length} ready · {portal.events.filter(event => !isReady(event)).length} need attention</p>
            {portal.changes_requested_reason ? <p>Changes requested: {portal.changes_requested_reason}</p> : null}
            {search.submitted ? <p role="status">Your plan was submitted to the church office.</p> : null}
            {portal.events.length ? <ul className="space-y-3">{portal.events.map(event => <li key={event.id}>
              <details><summary>{event.title} · {event.reference_code} · {isReady(event) ? "Ready" : "Needs attention"} · {event.schedule.start_date ?? "Date needed"} {event.schedule.start_time?.slice(0, 5) ?? ""}–{event.schedule.end_time?.slice(0, 5) ?? ""}</summary>
                <p>Requested rooms: {event.rooms.map(id => portal.rooms.find(room => room.id === id)?.name ?? "Unavailable room").join(", ") || "None"}</p>
                {portal.status !== "submitted" ? <EventForm plan={planId} timezone={context.timezone} catalog={portal} event={event} /> : <p>Submitted for review.</p>}
              </details>
            </li>)}</ul> : <p>No events have been added.</p>}
            {portal.status !== "submitted" ? <details><summary>Add an event</summary><EventForm plan={planId} timezone={context.timezone} catalog={portal} /></details> : null}
            {portal.status !== "submitted" ? <form action={submitPlannerPlan} className="space-y-3">
              <input type="hidden" name="plan" value={planId} />
              <label className="block">Message to the church office <textarea name="message" maxLength={2000} className="block w-full rounded border p-2" /></label>
              {!portal.events.length ? <label className="flex gap-2"><input type="checkbox" name="confirmEmpty" value="yes" required /> Confirm this plan has no events.</label> : null}
              <Button type="submit">Submit plan</Button>
            </form> : null}
          </section> : <p role="alert">Planning is temporarily unavailable. Please try again.</p>}
        {search.error === "consent" || search.error === "submit" || search.error === "save" ? <p role="alert">We could not complete that action. Please try again or contact the church office.</p> : null}
        {search.error === "notready" ? <p role="alert">Complete the dates, times, and repeat details for each event before submitting your plan.</p> : null}
        {search.error === "unavailableSelection" ? <p role="alert">A selected room, resource, or ministry is unavailable. Edit the event and remove that selection before submitting.</p> : null}
      </> : <>
        <h1 className="text-3xl font-semibold">{search.signedOut ? "You are signed out" : "Planning access unavailable"}</h1>
        {!search.signedOut ? <p>This invitation may have expired, been replaced, or the planning cycle may be closed. Contact the church office for help.</p> : null}
        {search.error === "unavailable" ? <p>Please wait and try again using your invitation link.</p> : null}
      </>}
      {!invitation && validPlan && session && TOKEN.test(session) ? <form action={signOutPlanner}>
        <input type="hidden" name="plan" value={planId} />
        <Button type="submit" variant="outline">Sign out</Button>
        {search.error === "signout" ? <p role="alert">We could not sign you out. Please try again.</p> : null}
      </form> : null}
    </main>
  );
}
