import type { EmailData } from "@/emails/types";
import { formatLongDate, formatTimeRange, timeZoneAbbreviation, toLocalParts } from "@/lib/datetime";
import { formatPhone } from "@/lib/format";

/** One row of `public.email_context` (see supabase/migrations/…_email_outbox.sql). */
export type EmailContextRow = {
  email_id: string;
  recipient: string;
  event_type: string;
  attempt_count: number;
  reservation_id: string;
  reference_code: string;
  room_name: string;
  room_capacity: number;
  start_at: string;
  end_at: string;
  requester_first_name: string;
  requester_last_name: string;
  requester_email: string;
  requester_phone: string;
  ministry_name: string | null;
  purpose: string;
  estimated_attendance: number;
  setup_requirements: string | null;
  requester_notes: string | null;
  requester_message: string | null;
  food_drinks_allowed: boolean;
  cancelled_by_requester: boolean;
  church_name: string;
  app_name: string;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
};

/** Pure mapping from the DB context to display-ready template data. */
export function toEmailData(row: EmailContextRow, links: { appUrl: string; manageUrl: string | null }): EmailData {
  const start = toLocalParts(row.start_at, row.timezone);
  const end = toLocalParts(row.end_at, row.timezone);
  const zone = timeZoneAbbreviation(row.timezone, new Date(row.start_at));
  const appUrl = links.appUrl.replace(/\/$/, "");

  return {
    appUrl,
    appName: row.app_name,
    churchName: row.church_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    referenceCode: row.reference_code,
    roomName: row.room_name,
    roomCapacity: row.room_capacity,
    date: formatLongDate(start.date),
    time: `${formatTimeRange(start.time, end.time)} ${zone}`,
    requesterName: `${row.requester_first_name} ${row.requester_last_name}`.trim(),
    requesterFirstName: row.requester_first_name,
    requesterEmail: row.requester_email,
    requesterPhone: formatPhone(row.requester_phone),
    ministry: row.ministry_name,
    purpose: row.purpose,
    estimatedAttendance: row.estimated_attendance,
    setupRequirements: row.setup_requirements,
    requesterNotes: row.requester_notes,
    requesterMessage: row.requester_message,
    foodDrinksAllowed: row.food_drinks_allowed,
    cancelledByRequester: row.cancelled_by_requester,
    manageUrl: links.manageUrl,
    adminUrl: `${appUrl}/admin/reservations/${row.reservation_id}`,
  };
}
