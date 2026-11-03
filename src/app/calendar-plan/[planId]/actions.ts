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

export async function signOutPlanner(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  if (!UUID.test(plan)) redirect("/");
  const store = await cookies();
  const session = store.get("calendar_planner")?.value;
  if (session && TOKEN.test(session)) {
    const { error } = await createSupabaseServiceClient().rpc("calendar_end_planner_session", {
      p_plan_id: plan, p_session_hash: hashPlannerBearer(session),
    });
    if (error) redirect(`/calendar-plan/${plan}?error=signout`);
  }
  store.set("calendar_planner", "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: `/calendar-plan/${plan}`, maxAge: 0,
  });
  redirect(`/calendar-plan/${plan}?signedOut=1`);
}

async function plannerCredentials(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  const session = (await cookies()).get("calendar_planner")?.value;
  if (!UUID.test(plan) || !session || !TOKEN.test(session)) redirect("/");
  return { plan, hash: hashPlannerBearer(session) };
}

export async function acceptPlannerPolicies(form: FormData) {
  const { plan, hash } = await plannerCredentials(form);
  if (form.get("accept") !== "yes") redirect(`/calendar-plan/${plan}?error=consent`);
  const { error } = await createSupabaseServiceClient().rpc("calendar_accept_planner_policies", {
    p_plan_id: plan, p_session_hash: hash,
    p_privacy_version: String(form.get("privacyVersion") ?? ""),
    p_terms_version: String(form.get("termsVersion") ?? ""),
  });
  if (error) redirect(`/calendar-plan/${plan}?error=consent`);
  redirect(`/calendar-plan/${plan}`);
}

export async function submitPlannerPlan(form: FormData) {
  const { plan, hash } = await plannerCredentials(form);
  const { error } = await createSupabaseServiceClient().rpc("calendar_submit_plan", {
    p_plan_id: plan, p_session_hash: hash, p_message: String(form.get("message") ?? ""),
    p_confirm_empty: form.get("confirmEmpty") === "yes",
  });
  if (error) {
    const reason = error.message === "Every event needs a complete schedule." ? "notready"
      : error.message === "An event contains an unavailable room, resource, or ministry." ? "unavailableSelection"
      : error.message === "A calendar event uses a nonexistent local time." ? "dst"
      : error.message === "A calendar event may have at most 1200 occurrences." ? "occurrenceLimit"
      : error.message === "The calendar schedule has no occurrences." ? "noOccurrences" : "submit";
    if (error.message === "An occurrence resource override needs an event-wide default.") redirect(`/calendar-plan/${plan}?error=override`);
    redirect(`/calendar-plan/${plan}?error=${reason}`);
  }
  redirect(`/calendar-plan/${plan}?submitted=1`);
}

export async function setOccurrenceException(form: FormData) {
  const { plan, hash } = await plannerCredentials(form);
  const event = String(form.get("event") ?? "");
  const occurrence = String(form.get("occurrence") ?? "");
  const item = String(form.get("item") ?? "");
  const kind = String(form.get("kind") ?? "");
  const operation = String(form.get("operation") ?? "");
  const version = Number(form.get("draft_version"));
  const quantityText = String(form.get("quantity") ?? "").trim();
  const quantity = quantityText ? Number(quantityText) : null;
  if (!UUID.test(event) || !UUID.test(occurrence) || !UUID.test(item) || !Number.isSafeInteger(version) || version < 1 ||
    (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000))) redirect(`/calendar-plan/${plan}?error=save`);
  const { error } = await createSupabaseServiceClient().rpc("calendar_set_occurrence_exception", {
    p_plan_id: plan, p_session_hash: hash, p_occurrence_id: occurrence, p_expected_version: version,
    p_kind: kind, p_item_id: item, p_operation: operation, p_quantity: quantity as number, p_notes: String(form.get("notes") ?? ""),
  });
  const page = Math.max(1, Number.parseInt(String(form.get("page") ?? "1"), 10) || 1);
  redirect(`/calendar-plan/${plan}/occurrences/${event}?page=${page}${error ? "&error=exception" : "&updated=1"}`);
}

export async function removePlannerDraft(form: FormData) {
  const { plan, hash } = await plannerCredentials(form);
  const id = String(form.get("event") ?? "");
  const version = Number(form.get("draft_version"));
  if (!UUID.test(id) || !Number.isSafeInteger(version) || version < 1) redirect(`/calendar-plan/${plan}?error=save`);
  const { error } = await createSupabaseServiceClient().rpc("calendar_remove_event_draft", {
    p_plan_id: plan, p_session_hash: hash, p_event_id: id, p_expected_version: version,
  });
  if (error) redirect(`/calendar-plan/${plan}?error=${error.message === "Event cannot be removed from this plan." ? "stale" : "save"}`);
  redirect(`/calendar-plan/${plan}`);
}

export async function duplicatePlannerDraft(form: FormData) {
  const { plan, hash } = await plannerCredentials(form);
  const id = String(form.get("event") ?? "");
  if (!UUID.test(id)) redirect(`/calendar-plan/${plan}?error=save`);
  const { error } = await createSupabaseServiceClient().rpc("calendar_duplicate_event_draft", {
    p_plan_id: plan, p_session_hash: hash, p_event_id: id,
  });
  if (error) redirect(`/calendar-plan/${plan}?error=save`);
  redirect(`/calendar-plan/${plan}`);
}

export async function savePlannerDraft(_previous: { error: string }, form: FormData): Promise<{ error: string }> {
  const { plan, hash } = await plannerCredentials(form);
  const id = String(form.get("event") ?? "");
  if (id && !UUID.test(id)) return { error: "This event cannot be edited. Refresh and try again." };
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const optionalNumber = (name: string) => value(name) ? Number(value(name)) : null;
  const frequency = value("frequency") || null;
  const kind = value("kind");
  const fixedInterval = kind === "recurring" && ["weekdays", "yearly_date", "yearly_nth_weekday"].includes(frequency ?? "");
  if (fixedInterval && value("interval_count") && value("interval_count") !== "1") {
    return { error: "Weekday and yearly schedules always repeat at an interval of 1." };
  }
  const allDay = form.has("all_day");
  const dateIds = form.getAll("date_id").map(String);
  const dateStarts = form.getAll("date_start").map(String);
  const dateEnds = form.getAll("date_end").map(String);
  const dateStartTimes = form.getAll("date_start_time").map(String);
  const dateEndTimes = form.getAll("date_end_time").map(String);
  if (kind === "specific_dates" && [dateStarts, dateEnds, dateStartTimes, dateEndTimes].some(values => values.length !== dateIds.length)) {
    return { error: "Check the selected dates and try again." };
  }
  const data = {
    draft_version: optionalNumber("draft_version"), title: value("title"), description: value("description"), public_description: value("public_description"),
    category: value("category"), scope: value("scope"), protection: value("protection"), visibility: value("visibility"),
    location_type: value("location_type"), offsite_location: value("offsite_location"), virtual_url: value("virtual_url"),
    estimated_attendance: Number(value("estimated_attendance")), food_drinks_planned: form.has("food_drinks_planned"),
    setup_minutes: Number(value("setup_minutes") || 0), cleanup_minutes: Number(value("cleanup_minutes") || 0),
    public_contact_name: value("public_contact_name"), public_contact_email: value("public_contact_email"), requester_notes: value("requester_notes"),
    schedule: { kind, timezone: value("timezone"), all_day: allDay, start_date: value("start_date"), end_date: value("end_date"),
      start_time: value("start_time"), end_time: value("end_time"), frequency: kind === "recurring" ? frequency : null,
      interval_count: kind === "recurring" ? fixedInterval ? 1 : optionalNumber("interval_count") : null,
      weekdays: kind === "recurring" && frequency === "weekly" ? form.getAll("weekdays").map(Number) : null,
      weekday: kind === "recurring" && ["monthly_nth_weekday", "yearly_nth_weekday"].includes(frequency ?? "") ? optionalNumber("weekday") : null,
      month_ordinals: kind === "recurring" && frequency === "monthly_nth_weekday" ? form.getAll("month_ordinals").map(Number) : null,
      month_ordinal: kind === "recurring" && frequency === "yearly_nth_weekday" ? optionalNumber("month_ordinal") : null,
      day_of_month: kind === "recurring" && ["monthly_day", "yearly_date"].includes(frequency ?? "") ? optionalNumber("day_of_month") : null,
      month_of_year: kind === "recurring" && ["yearly_date", "yearly_nth_weekday"].includes(frequency ?? "") ? optionalNumber("month_of_year") : null },
    dates: kind === "specific_dates" ? dateIds.map((id, i) => ({ id, start_date: dateStarts[i], end_date: dateEnds[i],
      start_time: allDay ? "" : dateStartTimes[i], end_time: allDay ? "" : dateEndTimes[i] })) : [],
    rooms: form.getAll("rooms").map(String), ministries: form.getAll("ministries").map(String),
    resources: form.getAll("resources").map(String).map(resource => ({ id: resource, quantity: Number(value(`resource_quantity_${resource}`) || 1), notes: value(`resource_notes_${resource}`) })),
  };
  const { error } = await createSupabaseServiceClient().rpc("calendar_save_event_draft", {
    // The generated RPC type does not represent nullable PostgreSQL arguments.
    p_plan_id: plan, p_session_hash: hash, p_event_id: id || (null as unknown as string), p_data: data,
  });
  if (error) {
    if (error.message === "Event changed or is not editable. Refresh before editing.") {
      return { error: "Another planner changed this event, or it is no longer editable. Copy any unsaved text before refreshing." };
    }
    const safeMessages = ["Schedule dates or timezone are invalid.", "Choose dates for the selected schedule.",
      "The recurrence rule is incomplete.", "Selected date is outside the schedule.", "Selected date is not editable.", "Duplicate selected date identity.", "Weekdays must be unique.",
      "Weeks of the month must be unique.", "Room unavailable.", "Resource unavailable.", "Ministry unavailable.",
      "This plan has been submitted."];
    return { error: safeMessages.includes(error.message) ? error.message : "Check your event details and dates, then try again. Your entries are still here." };
  }
  redirect(`/calendar-plan/${plan}`);
}
