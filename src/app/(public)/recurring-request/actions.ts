"use server";

import { addDaysToLocalDate, todayInZone } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal";
import { hitRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { fieldErrors } from "@/lib/validation/reservation";
import { recurringRequestSchema } from "@/lib/validation/recurring-request";

export type RecurringRequestState = {
  status: "idle" | "error" | "success";
  message?: string;
  reference?: string;
  fieldErrors?: Record<string, string>;
};

const MIN_FILL_MS = 3000;

export async function submitRecurringRequest(
  _previous: RecurringRequestState,
  formData: FormData,
): Promise<RecurringRequestState> {
  const startedAt = Number(formData.get("startedAt"));
  if (formData.get("website") || !Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return { status: "error", message: "We couldn't submit your request. Please review the form and try again." };
  }

  const parsed = recurringRequestSchema.safeParse({
    roomId: formData.get("roomId"),
    preferredStartDate: formData.get("preferredStartDate"),
    start: formData.get("start"),
    end: formData.get("end"),
    recurrenceDescription: formData.get("recurrenceDescription"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    purpose: formData.get("purpose"),
    estimatedAttendance: formData.get("estimatedAttendance"),
    requesterNotes: formData.get("requesterNotes"),
    legalAccepted: formData.get("legalAccepted") === "on",
  });
  if (!parsed.success) {
    return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const catalog = await loadCatalog();
  if (!catalog.ok) return { status: "error", message: "Room information is temporarily unavailable. Please try again shortly." };
  const room = catalog.catalog.rooms.find((item) => item.id === input.roomId);
  if (!room) return { status: "error", message: "Please choose an available room.", fieldErrors: { roomId: "Please choose an available room." } };
  const today = todayInZone(catalog.catalog.settings.timeZone);
  if (input.preferredStartDate < today) {
    return { status: "error", message: "Please choose today or a future date.", fieldErrors: { preferredStartDate: "Please choose today or a future date." } };
  }
  if (input.preferredStartDate > addDaysToLocalDate(today, 730)) {
    return { status: "error", message: "Please choose a start date within the next two years.", fieldErrors: { preferredStartDate: "Choose a date within the next two years." } };
  }

  const ip = await clientIp();
  const [ipAllowed, emailAllowed] = await Promise.all([
    hitRateLimit(RATE_LIMITS.recurringRequestPerIp, ip),
    hitRateLimit(RATE_LIMITS.recurringRequestPerEmail, input.email),
  ]);
  if (!ipAllowed || !emailAllowed) {
    return { status: "error", message: "Too many requests were submitted. Please wait and try again later." };
  }

  const { data, error } = await createSupabaseServiceClient()
    .rpc("create_recurring_reservation_request", {
      p_room_id: input.roomId,
      p_preferred_start_date: input.preferredStartDate,
      p_local_start_time: input.start,
      p_local_end_time: input.end,
      p_recurrence_description: input.recurrenceDescription,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_email: input.email,
      p_phone: input.phone,
      p_purpose: input.purpose,
      p_estimated_attendance: input.estimatedAttendance,
      p_requester_notes: input.requesterNotes,
      p_privacy_accepted: input.legalAccepted,
      p_terms_accepted: input.legalAccepted,
      p_privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
      p_terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
    })
    .single();
  if (error || !data) {
    console.error("[recurring-request] create failed", error);
    return { status: "error", message: "We couldn't submit your request. Please try again or contact the church office." };
  }
  return {
    status: "success",
    reference: data.reference_code,
    message: "Your recurring reservation request was sent to the church office.",
  };
}
