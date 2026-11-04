"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scheduleSystemEmailDelivery } from "@/lib/email/schedule";
import { assertPermission } from "@/lib/auth/guards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestCalendarChanges(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(plan) || !reason || reason.length > 2000) redirect("/admin/calendar-submissions?error=1");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_request_plan_changes", { p_plan_id: plan, p_reason: reason });
  if (error) redirect("/admin/calendar-submissions?error=1");
  scheduleSystemEmailDelivery();
  redirect("/admin/calendar-submissions?updated=1");
}

/** Wired only when Phase 6 review gates are complete. */
export async function approveCalendarEvent(form: FormData) {
  await assertPermission("calendar.view");
  const event = String(form.get("event") ?? "");
  const revision = Number(form.get("revision"));
  const commitment = String(form.get("commitment") ?? "");
  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  if (!UUID.test(event) || !Number.isSafeInteger(revision) || revision < 1 || (commitment && !UUID.test(commitment)) ||
    firstName.length < 1 || firstName.length > 80 || lastName.length < 1 || lastName.length > 80 || !/^\+[1-9][0-9]{6,14}$/.test(phone)) {
    redirect("/admin/calendar-submissions?error=contact");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_approve_event", { p_event_id:event,p_expected_revision:revision,
    p_first_name:firstName,p_last_name:lastName,p_phone:phone,...(commitment ? { p_expected_commitment:commitment } : {}) });
  if (error) {
    const reason = error.code === "RAR04" ? "schedule" : error.code === "RAR03" ? "past" : "approval";
    redirect(`/admin/calendar-submissions?error=${reason}`);
  }
  scheduleSystemEmailDelivery();
  redirect("/admin/calendar-submissions?updated=approval");
}

/** Wired only when Phase 6 review gates are complete. */
export async function cancelCalendarEvent(form: FormData) {
  await assertPermission("calendar.view");
  const event = String(form.get("event") ?? "");
  const commitment = String(form.get("commitment") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!UUID.test(event) || !UUID.test(commitment) || reason.length < 3 || reason.length > 2000) redirect("/admin/calendar-submissions?error=cancel");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_cancel_event", { p_event_id:event,p_expected_commitment:commitment,p_reason:reason });
  if (error) redirect("/admin/calendar-submissions?error=cancel");
  scheduleSystemEmailDelivery();
  redirect("/admin/calendar-submissions?updated=cancel");
}

/** Wired only when Phase 6 review gates are complete. */
export async function cancelCalendarOccurrence(form: FormData) {
  await assertPermission("calendar.view");
  const event = String(form.get("event") ?? "");
  const commitment = String(form.get("commitment") ?? "");
  const occurrence = String(form.get("occurrence") ?? "");
  const submission = String(form.get("submission") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (![event,commitment,occurrence,submission].every(value => UUID.test(value)) || reason.length < 3 || reason.length > 2000) redirect("/admin/calendar-submissions?error=cancel");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_cancel_event_occurrence", { p_event_id:event,p_expected_commitment:commitment,p_occurrence:occurrence,p_reason:reason });
  if (error) redirect(`/admin/calendar-submissions/occurrences/${submission}?error=cancel`);
  scheduleSystemEmailDelivery();
  redirect(`/admin/calendar-submissions/occurrences/${submission}?updated=cancel`);
}
