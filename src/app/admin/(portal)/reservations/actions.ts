"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertPermission } from "@/lib/auth/guards";
import {
  addMonthsToLocalDate,
  compareLocalDates,
  formatMediumDate,
  localDateToUtcMidnight,
  localToUtc,
  type LocalDate,
} from "@/lib/datetime";
import { getBusyBlocks } from "@/lib/data/availability";
import { loadCatalog } from "@/lib/data/catalog";
import { toAppError, type AppError } from "@/lib/domain/errors";
import { newGuestToken } from "@/lib/domain/guest-token";
import { scheduleEmailDelivery, scheduleSystemEmailDelivery } from "@/lib/email/schedule";
import { advanceLabel } from "@/lib/domain/rooms/advance-booking";
import { buildRecurrencePreview, type RecurrencePreview } from "@/lib/recurrence/preview";
import type { RecurrenceInput, RecurrenceRule, Weekday } from "@/lib/recurrence/types";
import { reserveContext } from "@/lib/reservations/reserve-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OTHER_MINISTRY } from "@/lib/validation/reservation";
import {
  staffMessageSchema,
  staffRecurrenceSchema,
  staffReservationSchema,
  type StaffRecurrenceInput,
} from "@/lib/validation/staff-reservation";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
type ActionFailure = Extract<ActionResult, { ok: false }>;
export type RecurrencePreviewResult =
  | { ok: true; preview: RecurrencePreview; materializedThrough: LocalDate; timeZone: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown, context?: { advanceLimitLabel?: string }): ActionFailure {
  const appError: AppError = toAppError(error, context);
  if (appError.kind === "unexpected") console.error("[admin] reservation action failed", error);
  return { ok: false, message: appError.message };
}

function refresh(id?: string) {
  revalidatePath("/admin", "layout");
  if (id) revalidatePath(`/admin/reservations/${id}`);
}

async function guard(permission: Parameters<typeof assertPermission>[0]): Promise<ActionFailure | null> {
  try {
    await assertPermission(permission);
    return null;
  } catch (error) {
    return failure(error);
  }
}

type RecurringSelection = {
  roomId: string;
  date: string;
  start: string;
  end: string;
  recurrence: StaffRecurrenceInput;
};

function recurrenceInput(selection: RecurringSelection): RecurrenceInput | null {
  const recurrence = staffRecurrenceSchema.safeParse(selection.recurrence);
  if (!recurrence.success || recurrence.data.frequency === "none") return null;
  const value = recurrence.data;
  let rule: RecurrenceRule;
  switch (value.frequency) {
    case "daily":
      rule = { frequency: value.frequency, interval: value.interval };
      break;
    case "weekdays":
      rule = { frequency: value.frequency };
      break;
    case "weekly":
      rule = { frequency: value.frequency, interval: value.interval, weekdays: value.weekdays as Weekday[] };
      break;
    case "monthly_day":
      rule = { frequency: value.frequency, interval: value.interval, dayOfMonth: value.dayOfMonth };
      break;
    case "monthly_nth_weekday":
      rule = {
        frequency: value.frequency,
        interval: value.interval,
        weekday: value.weekday as Weekday,
        ordinals: value.ordinals,
      };
      break;
    case "yearly_date":
      rule = { frequency: value.frequency, month: value.month, dayOfMonth: value.dayOfMonth };
      break;
    case "yearly_nth_weekday":
      rule = {
        frequency: value.frequency,
        month: value.month,
        weekday: value.weekday as Weekday,
        ordinal: value.ordinal,
      };
      break;
  }
  return {
    startDate: selection.date,
    endDate: recurrence.data.endDate,
    start: selection.start,
    end: selection.end,
    rule,
  };
}

function inclusiveDayCount(from: LocalDate, through: LocalDate): number {
  return Math.floor((localDateToUtcMidnight(through).getTime() - localDateToUtcMidnight(from).getTime()) / 86_400_000) + 1;
}

async function buildStaffRecurrencePreview(selection: RecurringSelection): Promise<RecurrencePreviewResult> {
  const input = recurrenceInput(selection);
  if (!UUID.test(selection.roomId) || !input) {
    return { ok: false, message: "Choose a valid recurring schedule before previewing it." };
  }
  const catalog = await loadCatalog();
  if (!catalog.ok) return { ok: false, message: "Settings couldn't be loaded. Please try again." };
  const context = reserveContext(catalog.catalog);
  const room = context.rooms.find((candidate) => candidate.id === selection.roomId);
  if (!room) return { ok: false, message: "This room isn't available for reservations right now." };
  const requestedThrough = input.endDate ?? addMonthsToLocalDate(input.startDate, 12);
  const materializedThrough = compareLocalDates(requestedThrough, room.horizon) < 0 ? requestedThrough : room.horizon;
  if (compareLocalDates(materializedThrough, input.startDate) < 0) {
    return {
      ok: false,
      message: "The selected room has no reservable dates in this series window.",
      fieldErrors: { recurrence: "Choose an earlier start date or another room." },
    };
  }

  try {
    const busy = await getBusyBlocks(
      [room.id],
      input.startDate,
      inclusiveDayCount(input.startDate, materializedThrough),
      context.settings.timeZone,
    );
    const preview = buildRecurrencePreview(input, {
      throughDate: materializedThrough,
      timeZone: context.settings.timeZone,
      busyBlocks: busy.get(room.id) ?? [],
    });
    if (!preview.occurrences.length) {
      return {
        ok: false,
        message: "This rule doesn't produce an occurrence inside the room's current booking window.",
        fieldErrors: { recurrence: "Change the weekday, start date, or room." },
      };
    }
    return { ok: true, preview, materializedThrough, timeZone: context.settings.timeZone };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The recurring schedule couldn't be previewed.";
    return { ok: false, message, fieldErrors: { recurrence: message } };
  }
}

export async function previewRecurringReservationAction(input: unknown): Promise<RecurrencePreviewResult> {
  const denied = await guard("reservations.createApproved");
  if (denied) return denied;
  if (!input || typeof input !== "object") return { ok: false, message: "Choose a valid recurring schedule." };
  const value = input as RecurringSelection;
  return buildStaffRecurrencePreview(value);
}

export async function approveReservationAction(id: string, input: { message?: string }): Promise<ActionResult> {
  const denied = await guard("reservations.approve");
  if (denied) return denied;
  const parsed = staffMessageSchema.safeParse(input);
  if (!UUID.test(id) || !parsed.success) return { ok: false, message: "Please check the message and try again." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_reservation", { p_id: id, p_message: parsed.data.message || undefined });
  if (error) return failure(error);
  scheduleEmailDelivery(id);
  refresh(id);
  return { ok: true, message: "Reservation approved." };
}

export async function declineReservationAction(id: string, input: { message?: string; adminNote?: string }): Promise<ActionResult> {
  const denied = await guard("reservations.decline");
  if (denied) return denied;
  const parsed = staffMessageSchema.safeParse(input);
  if (!UUID.test(id) || !parsed.success) return { ok: false, message: "Please check the message and try again." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decline_reservation", {
    p_id: id,
    p_message: parsed.data.message || undefined,
    p_admin_note: parsed.data.adminNote || undefined,
  });
  if (error) return failure(error);
  scheduleEmailDelivery(id);
  refresh(id);
  return { ok: true, message: "Reservation declined." };
}

export async function cancelReservationAction(id: string, input: { message?: string }): Promise<ActionResult> {
  const denied = await guard("reservations.cancel");
  if (denied) return denied;
  const parsed = staffMessageSchema.safeParse(input);
  if (!UUID.test(id) || !parsed.success) return { ok: false, message: "Please check the message and try again." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_reservation", { p_id: id, p_message: parsed.data.message || undefined });
  if (error) return failure(error);
  scheduleEmailDelivery(id);
  refresh(id);
  return { ok: true, message: "Reservation cancelled." };
}

export async function saveAdminNotesAction(id: string, notes: string): Promise<ActionResult> {
  const denied = await guard("reservations.edit");
  if (denied) return denied;
  const parsed = staffMessageSchema.safeParse({ adminNote: notes });
  if (!UUID.test(id) || !parsed.success) return { ok: false, message: "Notes must be under 4,000 characters." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_admin_notes", { p_id: id, p_admin_notes: parsed.data.adminNote ?? "" });
  if (error) return failure(error);
  refresh(id);
  return { ok: true, message: "Notes saved." };
}

export async function endReservationSeriesAction(id: string): Promise<ActionResult> {
  const denied = await guard("reservations.edit");
  if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, message: "Recurring series not found." };

  const supabase = await createSupabaseServerClient();
  const { data: changed, error } = await supabase.rpc("admin_end_reservation_series", { p_id: id });
  if (error) return failure(error);
  refresh();
  revalidatePath(`/admin/reservation-series/${id}`);
  return {
    ok: true,
    message: changed
      ? "Recurring series ended. Existing reservations were kept."
      : "This recurring series was already ended.",
  };
}

/** Shared by create and edit: validates, converts church-local times to UTC. */
async function prepare(input: unknown) {
  const parsed = staffReservationSchema.safeParse(input);
  if (!parsed.success) {
    const flat: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[issue.path[0] === "reservation" ? 1 : 0] ?? "form");
      flat[key] ??= issue.message;
    }
    return { error: { ok: false as const, message: "Please check the highlighted fields.", fieldErrors: flat } };
  }
  const catalog = await loadCatalog();
  if (!catalog.ok) return { error: { ok: false as const, message: "Settings couldn't be loaded. Please try again." } };
  const { reservation: r } = parsed.data;
  const tz = catalog.catalog.settings.timeZone;
  const startAt = localToUtc(r.date, r.start, tz);
  const endAt = localToUtc(r.date, r.end, tz);
  if (!startAt || !endAt) {
    return {
      error: {
        ok: false as const,
        message: "That time doesn't exist on this date (daylight saving time change).",
        fieldErrors: { start: "Please choose another time." },
      },
    };
  }
  const room = catalog.catalog.rooms.find((x) => x.id === r.roomId);
  return {
    data: parsed.data,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    advanceLimitLabel: room ? advanceLabel(room.advance) : undefined,
  };
}

export async function updateReservationAction(id: string, input: unknown): Promise<ActionResult> {
  const denied = await guard("reservations.edit");
  if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, message: "Reservation not found." };
  const prepared = await prepare(input);
  if ("error" in prepared) return prepared.error!;
  const { data, startAt, endAt, advanceLimitLabel } = prepared;
  const r = data.reservation;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_reservation", {
    p_id: id,
    p_room_id: r.roomId,
    p_start_at: startAt,
    p_end_at: endAt,
    p_first_name: r.firstName,
    p_last_name: r.lastName,
    p_email: r.email,
    p_phone: r.phone,
    p_purpose: r.purpose,
    p_estimated_attendance: r.estimatedAttendance,
    p_ministry_id: r.ministryId === OTHER_MINISTRY ? undefined : r.ministryId,
    p_other_ministry_name: r.otherMinistryName,
    p_setup_requirements: r.setupRequirements,
    p_requester_notes: r.requesterNotes,
    p_admin_notes: data.adminNotes,
    p_notify: data.notify,
  });
  if (error) return failure(error, { advanceLimitLabel });
  scheduleEmailDelivery(id);
  refresh(id);
  redirect(`/admin/reservations/${id}?updated=1`);
}

export async function createStaffReservationAction(input: unknown): Promise<ActionResult> {
  const denied = await guard("reservations.createApproved");
  if (denied) return denied;
  const prepared = await prepare(input);
  if ("error" in prepared) return prepared.error!;
  const { data, startAt, endAt, advanceLimitLabel } = prepared;
  const r = data.reservation;

  if (data.recurrence.frequency !== "none") {
    const result = await buildStaffRecurrencePreview({
      roomId: r.roomId,
      date: r.date,
      start: r.start,
      end: r.end,
      recurrence: data.recurrence,
    });
    if (!result.ok) return result;
    if (result.preview.invalidLocalTimeDates.length) {
      const dates = result.preview.invalidLocalTimeDates.map(formatMediumDate).join(", ");
      return {
        ok: false,
        message: `The selected time doesn't exist on: ${dates}. Choose another time.`,
        fieldErrors: { recurrence: "One or more dates fall in a daylight-saving time gap." },
      };
    }
    if (result.preview.conflicts.length) {
      const dates = result.preview.conflicts.map((conflict) => formatMediumDate(conflict.date)).join(", ");
      return {
        ok: false,
        message: `These dates conflict with existing reservations: ${dates}. No reservations were created.`,
        fieldErrors: { recurrence: "Resolve every conflict before creating the series." },
      };
    }

    const occurrences = result.preview.occurrences.map((occurrence) => {
      const link = newGuestToken();
      return {
        occurrence_date: occurrence.date,
        start_at: occurrence.startAt!,
        end_at: occurrence.endAt!,
        token_hash: link.hash.replace(/^\\x/, ""),
        token_seed: link.seed.replace(/^\\x/, ""),
      };
    });
    const recurrence = data.recurrence;
    const supabase = await createSupabaseServerClient();
    const { data: created, error } = await supabase
      .rpc("create_recurring_reservation_series", {
        p_room_id: r.roomId,
        p_frequency: recurrence.frequency,
        p_interval_count: "interval" in recurrence ? recurrence.interval : 1,
        p_weekdays: recurrence.frequency === "weekly" ? recurrence.weekdays : [],
        p_weekday:
          recurrence.frequency === "monthly_nth_weekday" || recurrence.frequency === "yearly_nth_weekday"
            ? recurrence.weekday
            : (null as unknown as number),
        p_month_ordinals:
          recurrence.frequency === "monthly_nth_weekday"
            ? recurrence.ordinals
            : [],
        p_month_ordinal:
          recurrence.frequency === "yearly_nth_weekday"
            ? recurrence.ordinal
            : (null as unknown as number),
        p_day_of_month:
          recurrence.frequency === "monthly_day" || recurrence.frequency === "yearly_date"
            ? recurrence.dayOfMonth
            : (null as unknown as number),
        p_month_of_year:
          recurrence.frequency === "yearly_date" || recurrence.frequency === "yearly_nth_weekday"
            ? recurrence.month
            : (null as unknown as number),
        p_instance_limit: 50,
        p_start_date: r.date,
        p_end_date: (recurrence.endDate ?? null) as string,
        p_local_start_time: r.start,
        p_local_end_time: r.end,
        p_timezone: result.timeZone,
        p_first_name: r.firstName,
        p_last_name: r.lastName,
        p_email: r.email,
        p_phone: r.phone,
        p_purpose: r.purpose,
        p_estimated_attendance: r.estimatedAttendance,
        p_occurrences: occurrences,
        p_materialized_through: result.materializedThrough,
        p_ministry_id: r.ministryId === OTHER_MINISTRY ? undefined : r.ministryId,
        p_other_ministry_name: r.otherMinistryName,
        p_setup_requirements: r.setupRequirements,
        p_requester_notes: r.requesterNotes,
        p_admin_notes: data.adminNotes,
        p_notify: data.notify,
      })
      .single();
    if (error || !created) return failure(error, { advanceLimitLabel });
    scheduleSystemEmailDelivery(created.series_id);
    refresh();
    redirect(`/admin/reservation-series/${created.series_id}?created=1`);
  }

  const link = newGuestToken();
  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .rpc("create_staff_reservation", {
      p_room_id: r.roomId,
      p_start_at: startAt,
      p_end_at: endAt,
      p_first_name: r.firstName,
      p_last_name: r.lastName,
      p_email: r.email,
      p_phone: r.phone,
      p_purpose: r.purpose,
      p_estimated_attendance: r.estimatedAttendance,
      // The requester still gets a management link, like any guest reservation.
      p_token_hash: link.hash,
      p_token_seed: link.seed,
      p_ministry_id: r.ministryId === OTHER_MINISTRY ? undefined : r.ministryId,
      p_other_ministry_name: r.otherMinistryName,
      p_setup_requirements: r.setupRequirements,
      p_requester_notes: r.requesterNotes,
      p_admin_notes: data.adminNotes,
      p_notify: data.notify,
    })
    .single();
  if (error || !created) return failure(error, { advanceLimitLabel });
  scheduleEmailDelivery(created.id);
  refresh();
  redirect(`/admin/reservations/${created.id}?created=1`);
}

export async function retryEmailAction(reservationId: string, emailId: string): Promise<ActionResult> {
  const denied = await guard("reservations.edit");
  if (denied) return denied;
  if (!UUID.test(reservationId) || !UUID.test(emailId)) return { ok: false, message: "Email not found." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("retry_email", { p_id: emailId });
  if (error) return failure(error);
  scheduleEmailDelivery(reservationId);
  refresh(reservationId);
  return { ok: true, message: "Email queued to send again." };
}
