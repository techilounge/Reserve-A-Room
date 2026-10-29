"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { hashPlannerBearer, newPlannerSession } from "@/lib/calendar-planning/token";
import { clientIp } from "@/lib/security/request";
import { rateLimitKey } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function openPlannerInvitation(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  const grant = String(form.get("grant") ?? "");
  const token = String(form.get("token") ?? "");
  if (!UUID.test(plan) || !UUID.test(grant) || !TOKEN.test(token)) redirect("/");
  const supabase = createSupabaseServiceClient();
  // Fail closed for this sensitive credential exchange if the limiter is unavailable.
  const ip = await clientIp();
  const { data: allowed, error: limitError } = await supabase.rpc("hit_rate_limit", {
    p_bucket: "calendar:exchange", p_key_hash: rateLimitKey(`${ip}:${plan}`), p_limit: 20, p_window_seconds: 3600,
  });
  if (limitError || allowed !== true) redirect(`/calendar-plan/${plan}?error=unavailable`);
  const session = newPlannerSession();
  const { data, error } = await supabase.rpc("exchange_calendar_planner_session", {
    p_plan_id: plan, p_grant_id: grant, p_token_hash: hashPlannerBearer(token), p_session_hash: session.hash,
  });
  if (error || data !== true) redirect(`/calendar-plan/${plan}?error=invalid`);
  (await cookies()).set("calendar_planner", session.bearer, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: `/calendar-plan/${plan}`, maxAge: 12 * 60 * 60,
  });
  redirect(`/calendar-plan/${plan}`);
}
