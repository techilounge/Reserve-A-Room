"use server";

import { addDaysToLocalDate, todayInZone } from "@/lib/datetime";
import { timeGrid } from "@/lib/availability-query";
import { loadCatalog } from "@/lib/data/catalog";
import { scheduleSystemEmailDelivery } from "@/lib/email/schedule";
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
  values?: RecurringRequestFormValues;
};

export type RecurringRequestFormValues = {
  roomId: string;
  preferredStartDate: string;
  start: string;
  end: string;
  recurrenceDescription: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  purpose: string;
  estimatedAttendance: string;
  requesterNotes: string;
  legalAccepted: boolean;
};

const MIN_FILL_MS = 3000;

function submittedValues(formData: FormData): RecurringRequestFormValues {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    roomId: text("roomId"),
    preferredStartDate: text("preferredStartDate"),
    start: text("start"),
    end: text("end"),
    recurrenceDescription: text("recurrenceDescription"),
    firstName: text("firstName"),
    lastName: text("lastName"),
    email: text("email"),
    phone: text("phone"),
    purpose: text("purpose"),
    estimatedAttendance: text("estimatedAttendance"),
    requesterNotes: text("requesterNotes"),
    legalAccepted: formData.get("legalAccepted") === "on",
  };
}

function errorState(
  message: string,
  values: RecurringRequestFormValues,
  errors?: Record<string, string>,
): RecurringRequestState {
  return { status: "error", message, fieldErrors: errors, values };
}

export async function submitRecurringRequest(
  _previous: RecurringRequestState,
  formData: FormData,
): Promise<RecurringRequestState> {
  const values = submittedValues(formData);
  const startedAt = Number(formData.get("startedAt"));
  if (formData.get("website") || !Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return errorState("We couldn't submit your request. Please review the form and try again.", values);
  }

  const parsed = recurringRequestSchema.safeParse(values);
  if (!parsed.success) {
    return errorState("Please check the highlighted fields.", values, fieldErrors(parsed.error));
  }

  const input = parsed.data;
  const catalog = await loadCatalog();
  if (!catalog.ok) return errorState("Room information is temporarily unavailable. Please try again shortly.", values);
  const room = catalog.catalog.rooms.find((item) => item.id === input.roomId);
  if (!room) return errorState("Please choose an available room.", values, { roomId: "Please choose an available room." });
  const grid = timeGrid(
    catalog.catalog.settings.dayStart,
    catalog.catalog.settings.dayEnd,
    catalog.catalog.settings.intervalMinutes,
  );
  if (!grid.includes(input.start) || input.start === grid.at(-1)) {
    return errorState("Please choose a start time from the list.", values, { start: "Please choose a start time from the list." });
  }
  if (!grid.includes(input.end)) {
    return errorState("Please choose an end time from the list.", values, { end: "Please choose an end time from the list." });
  }
  const today = todayInZone(catalog.catalog.settings.timeZone);
  if (input.preferredStartDate < today) {
    return errorState("Please choose today or a future date.", values, { preferredStartDate: "Please choose today or a future date." });
  }
  if (input.preferredStartDate > addDaysToLocalDate(today, 730)) {
    return errorState("Please choose a start date within the next two years.", values, { preferredStartDate: "Choose a date within the next two years." });
  }

  const ip = await clientIp();
  const [ipAllowed, emailAllowed] = await Promise.all([
    hitRateLimit(RATE_LIMITS.recurringRequestPerIp, ip),
    hitRateLimit(RATE_LIMITS.recurringRequestPerEmail, input.email),
  ]);
  if (!ipAllowed || !emailAllowed) {
    return errorState("Too many requests were submitted. Please wait and try again later.", values);
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
    return errorState("We couldn't submit your request. Please try again or contact the church office.", values);
  }
  scheduleSystemEmailDelivery(data.id);
  return {
    status: "success",
    reference: data.reference_code,
    message: "Your recurring reservation request was sent to the church office.",
  };
}
