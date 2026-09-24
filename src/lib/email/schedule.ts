import "server-only";

import { after } from "next/server";

import { deliverQueuedEmails } from "./outbox";

/**
 * Sends a reservation's queued emails after the response has been sent, so the requester
 * or staff member never waits on the email provider. Anything missed here (a crash, a
 * cold-start timeout) stays queued for the cron sweep (/api/cron/email-outbox).
 */
export function scheduleEmailDelivery(reservationId?: string) {
  after(async () => {
    try {
      await deliverQueuedEmails({ reservationId });
    } catch (error) {
      console.error("[email] background delivery failed", reservationId, error);
    }
  });
}
