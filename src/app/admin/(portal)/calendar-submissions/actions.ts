"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requestCalendarChanges(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(plan) || !reason || reason.length > 2000) redirect("/admin/calendar-submissions?error=1");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_request_plan_changes", { p_plan_id: plan, p_reason: reason });
  if (error) redirect("/admin/calendar-submissions?error=1");
  redirect("/admin/calendar-submissions?updated=1");
}
