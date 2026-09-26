import "server-only";

import { after } from "next/server";

import { deliverQueuedEmails } from "./outbox";
import { deliverQueuedSystemEmails } from "./system-outbox";

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

/** Background delivery for entity-backed messages such as one recurring-series summary. */
export function scheduleSystemEmailDelivery(entityId?: string) {
  after(async () => {
    try {
      await deliverQueuedSystemEmails({ entityId });
    } catch (error) {
      console.error("[system-email] background delivery failed", entityId, error);
    }
  });
}
