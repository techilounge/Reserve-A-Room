export const EMAIL_EVENTS = [
  "request_submitted",
  "admin_new_request",
  "reservation_confirmed",
  "reservation_approved",
  "reservation_declined",
  "reservation_modified",
  "reservation_cancelled",
  "admin_reservation_cancelled",
] as const;

export type EmailEvent = (typeof EMAIL_EVENTS)[number];

export function isEmailEvent(value: string): value is EmailEvent {
  return (EMAIL_EVENTS as readonly string[]).includes(value);
}

/** Shared identity/contact fields used by every branded email. */
export type EmailBrandData = {
  appUrl: string;
  appName: string;
  churchName: string;
  contactEmail: string | null;
  contactPhone: string | null;
};

/**
 * Everything a template renders, already formatted for display in the church timezone.
 * Built by src/lib/email/outbox.ts from `email_context`; templates never touch the DB.
 */
export type EmailData = EmailBrandData & {
  referenceCode: string;
  roomName: string;
  roomCapacity: number;
  /** "Wednesday, October 1, 2026" */
  date: string;
  /** "9:00 AM – 10:30 AM CDT" */
  time: string;

  requesterName: string;
  requesterFirstName: string;
  requesterEmail: string;
  requesterPhone: string;
  ministry: string | null;
  purpose: string;
  estimatedAttendance: number;
  setupRequirements: string | null;
  requesterNotes: string | null;
  /** Staff message addressed to the requester (approve / decline / cancel). */
  requesterMessage: string | null;
  foodDrinksAllowed: boolean;
  cancelledByRequester: boolean;

  /** Secure manage link for the requester, or null when it can't be rebuilt. */
  manageUrl: string | null;
  /** Staff link to the reservation in the admin portal. */
  adminUrl: string;
};
