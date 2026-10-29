"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertPermission } from "@/lib/auth/guards";
import { newPlannerGrant, newPlannerToken } from "@/lib/calendar-planning/token";
import { localToUtc } from "@/lib/datetime";
import { scheduleSystemEmailDelivery } from "@/lib/email/schedule";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BASE = "/admin/church-calendar";
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function finish(message: string, error = false): never {
  revalidatePath(BASE);
  redirect(`${BASE}?${error ? "error" : "message"}=${encodeURIComponent(message)}`);
}

function instant(value: string) {
  const [date, time] = value.split("T");
  return date && time ? localToUtc(date, time, "America/Chicago")?.toISOString() : undefined;
}

export async function saveCycle(form: FormData) {
  await assertPermission("churchCalendar.manage");
  const id = str(form, "id");
  const opens = instant(str(form, "opens"));
  const deadline = instant(str(form, "deadline"));
  if ((id && !uuid.test(id)) || !opens || !deadline) finish("Enter valid dates and times in the church time zone.", true);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_calendar_cycle", {
    p_id: (id || null) as unknown as string, p_name: str(form, "name"), p_start_date: str(form, "start"),
    p_end_date: str(form, "end"), p_opens_at: opens, p_deadline: deadline, p_instructions: str(form, "instructions"),
  });
  if (error) finish("Could not save the cycle. Check the dates, three-year limit, and cycle status.", true);
  finish("Planning cycle saved.");
}

export async function transitionCycle(form: FormData) {
  await assertPermission("churchCalendar.manage");
  const id = str(form, "id");
  const status = str(form, "status");
  const reason = str(form, "reason");
  if (!uuid.test(id) || !["open", "review", "finalized", "archived"].includes(status)) finish("Invalid cycle transition.", true);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transition_calendar_cycle", { p_id: id, p_status: status, p_reason: reason });
  if (error) finish("Could not change the cycle status. Reopening requires a reason of at least three characters.", true);
  finish("Planning cycle status updated.");
}

export async function addMinistry(form: FormData) {
  await assertPermission("churchCalendar.manage");
  const cycle = str(form, "cycle"); const ministry = str(form, "ministry");
  if (!uuid.test(cycle) || !uuid.test(ministry)) finish("Choose a cycle and ministry.", true);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_calendar_ministry", { p_cycle_id: cycle, p_ministry_id: ministry });
  if (error) finish("Could not add this ministry. It may already participate or the cycle may be closed.", true);
  finish("Ministry added to the cycle.");
}

export async function invitePlanner(form: FormData) {
  await assertPermission("churchCalendar.manage");
  if ((getServerEnv().CALENDAR_PLAN_LINK_SECRET?.length ?? 0) < 32) finish("Calendar invitation email is not configured. Ask the application owner to set CALENDAR_PLAN_LINK_SECRET.", true);
  const plan = str(form, "plan");
  if (!uuid.test(plan)) finish("Choose a valid ministry plan.", true);
  const grant = newPlannerGrant();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("invite_calendar_planner", {
    p_plan_id: plan, p_grant_id: grant.id, p_name: str(form, "name"), p_email: str(form, "email"),
    p_phone: str(form, "phone"), p_label: str(form, "label"), p_token_hash: grant.hash, p_token_seed: grant.seed,
  });
  if (error || !data) finish("Could not queue the invitation. Check the contact details, cycle status, and five-planner limit.", true);
  scheduleSystemEmailDelivery(data);
  finish("Invitation queued for email delivery.");
}

export async function rotatePlanner(form: FormData) {
  await assertPermission("churchCalendar.manage");
  if ((getServerEnv().CALENDAR_PLAN_LINK_SECRET?.length ?? 0) < 32) finish("Calendar invitation email is not configured. Ask the application owner to set CALENDAR_PLAN_LINK_SECRET.", true);
  const id = str(form, "id"); const version = Number(str(form, "version"));
  if (!uuid.test(id) || !Number.isSafeInteger(version) || version < 1) finish("Invalid invitation.", true);
  const token = newPlannerToken(id, version + 1);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("rotate_calendar_invitation", {
    p_grant_id: id, p_expected_version: version, p_token_hash: token.hash, p_token_seed: token.seed,
  });
  if (error || !data) finish("Could not replace the invitation. Refresh and check that it remains active.", true);
  scheduleSystemEmailDelivery(data);
  finish("A replacement invitation was queued. The previous link and session are invalid.");
}

export async function revokePlanner(form: FormData) {
  await assertPermission("churchCalendar.manage");
  const id = str(form, "id");
  if (!uuid.test(id)) finish("Invalid invitation.", true);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_calendar_planner", { p_grant_id: id });
  if (error) finish("Could not revoke this invitation. Refresh and check the cycle status.", true);
  finish("Planner access revoked.");
}

export async function saveResource(form: FormData) {
  await assertPermission("churchCalendar.manage");
  const id = str(form, "id"); const quantity = Number(str(form, "quantity"));
  if ((id && !uuid.test(id)) || !Number.isSafeInteger(quantity) || quantity < 1) finish("Enter a valid resource and quantity.", true);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_calendar_resource", {
    p_id: (id || null) as unknown as string, p_name: str(form, "name"), p_category: str(form, "category"),
    p_quantity: quantity, p_active: form.get("active") === "on", p_description: str(form, "description"),
    p_private_notes: str(form, "notes"),
  });
  if (error) finish("Could not save the resource. Check its name, category, and quantity.", true);
  finish("Calendar resource saved.");
}
