import type { Metadata } from "next";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import { hashPlannerBearer } from "@/lib/calendar-planning/token";
import { formatInstant, formatLongDate, type LocalDate } from "@/lib/datetime";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { openPlannerInvitation } from "./actions";

export const metadata: Metadata = { title: "Church calendar invitation", robots: { index: false, follow: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Context = { contact_name: string; ministry_name: string; cycle_name: string; start_date: LocalDate;
  end_date: LocalDate; deadline: string; instructions: string | null; timezone: string };

export default async function PlannerInvitationPage({ params, searchParams }: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ grant?: string; token?: string; error?: string }>;
}) {
  const { planId } = await params;
  const search = await searchParams;
  const validPlan = UUID.test(planId);
  let context: Context | null = null;
  const session = (await cookies()).get("calendar_planner")?.value;
  if (validPlan && session && TOKEN.test(session) && !search.token) {
    const { data } = await createSupabaseServiceClient().rpc("calendar_planner_session_context", {
      p_plan_id: planId, p_session_hash: hashPlannerBearer(session),
    });
    context = data as Context | null;
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
        <p className="text-muted-foreground">The church office will share the planning form when it is ready.</p>
      </> : <>
        <h1 className="text-3xl font-semibold">Planning access unavailable</h1>
        <p>This invitation may have expired, been replaced, or the planning cycle may be closed. Contact the church office for help.</p>
        {search.error === "unavailable" ? <p>Please wait and try again using your invitation link.</p> : null}
      </>}
    </main>
  );
}
