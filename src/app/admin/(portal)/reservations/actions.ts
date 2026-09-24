"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertPermission } from "@/lib/auth/guards";
import { localToUtc } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { toAppError, type AppError } from "@/lib/domain/errors";
import { newGuestToken } from "@/lib/domain/guest-token";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { advanceLabel } from "@/lib/domain/rooms/advance-booking";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OTHER_MINISTRY } from "@/lib/validation/reservation";
import { staffMessageSchema, staffReservationSchema } from "@/lib/validation/staff-reservation";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown, context?: { advanceLimitLabel?: string }): ActionResult {
  const appError: AppError = toAppError(error, context);
  if (appError.kind === "unexpected") console.error("[admin] reservation action failed", error);
  return { ok: false, message: appError.message };
}

function refresh(id?: string) {
  revalidatePath("/admin", "layout");
  if (id) revalidatePath(`/admin/reservations/${id}`);
}

async function guard(permission: Parameters<typeof assertPermission>[0]): Promise<ActionResult | null> {
  try {
    await assertPermission(permission);
    return null;
  } catch (error) {
    return failure(error);
  }
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
