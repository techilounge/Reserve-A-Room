import "server-only";

import { Resend } from "resend";

import { isEmailEvent } from "@/emails/types";
import { getAppUrl } from "@/lib/app-url";
import { seedFromDatabase, tokenFromSeed } from "@/lib/domain/guest-token";
import { getServerEnv, isProductionDeployment } from "@/lib/env/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { formatFrom } from "./address";
import { toEmailData, type EmailContextRow } from "./data";
import { renderEmail } from "./render";

/**
 * Email outbox worker (ADR-10). Reservation changes queue email_logs rows in the same
 * transaction; this claims them, renders the React Email template and sends it through
 * Resend. A failure is recorded on the row (and staff get an in-app alert for requester
 * emails) — it never affects the reservation itself.
 */

type Outcome = "sent" | "failed" | "skipped";
type Service = ReturnType<typeof createSupabaseServiceClient>;

const STAFF_EVENTS = new Set(["admin_new_request", "admin_reservation_cancelled"]);

export async function deliverQueuedEmails(options: { reservationId?: string; limit?: number } = {}) {
  const supabase = createSupabaseServiceClient();
  const { data: ids, error } = await supabase.rpc("claim_emails", {
    p_limit: options.limit ?? 20,
    p_reservation_id: options.reservationId,
  });
  if (error) throw error;

  const totals: Record<Outcome, number> = { sent: 0, failed: 0, skipped: 0 };
  for (const id of ids ?? []) {
    totals[await deliverOne(supabase, id)] += 1;
  }
  return totals;
}

async function deliverOne(supabase: Service, id: string): Promise<Outcome> {
  let outcome: { status: Outcome; providerId?: string; error?: string };
  try {
    outcome = await send(supabase, id);
  } catch (error) {
    console.error("[email] delivery failed", id, error);
    outcome = { status: "failed", error: error instanceof Error ? error.message : "Unexpected error while sending." };
  }

  const { error } = await supabase.rpc("complete_email", {
    p_id: id,
    p_status: outcome.status,
    p_provider_message_id: outcome.providerId,
    p_error: outcome.error,
  });
  if (error) console.error("[email] could not record result", id, error);
  return outcome.status;
}

async function send(supabase: Service, id: string): Promise<{ status: Outcome; providerId?: string; error?: string }> {
  const { data: rows, error } = await supabase.rpc("email_context", { p_email_id: id });
  if (error) throw error;
  // Generated RPC types can't express nullability; EmailContextRow documents it.
  const ctx: (EmailContextRow & { guest_token_seed: string | null; email_sender_name: string | null }) | undefined = rows?.[0];
  if (!ctx) return { status: "failed", error: "The reservation for this email no longer exists." };
  if (!isEmailEvent(ctx.event_type)) return { status: "failed", error: `Unknown email type: ${ctx.event_type}` };

  const appUrl = getAppUrl().origin;
  const isStaffEmail = STAFF_EVENTS.has(ctx.event_type);
  const manageUrl =
    !isStaffEmail && ctx.guest_token_seed
      ? `${appUrl}/reservation/${encodeURIComponent(ctx.reference_code)}?token=${tokenFromSeed(seedFromDatabase(ctx.guest_token_seed))}`
      : null;
  const email = await renderEmail(ctx.event_type, toEmailData(ctx, { appUrl, manageUrl }));

  const env = getServerEnv();
  const from = env.RESEND_FROM_EMAIL ? formatFrom(ctx.email_sender_name, env.RESEND_FROM_EMAIL) : null;
  if (!env.RESEND_API_KEY || !from) {
    const problem = "Email delivery is not configured (RESEND_API_KEY and RESEND_FROM_EMAIL).";
    if (isProductionDeployment()) return { status: "failed", error: problem };
    // Development / previews without a key: show what would have been sent.
    console.info(`[email] skipped (${problem})\n  to: ${ctx.recipient}\n  subject: ${email.subject}\n${email.text}`);
    return { status: "skipped" };
  }

  const replyTo = isStaffEmail ? ctx.requester_email : (env.RESEND_REPLY_TO ?? ctx.contact_email ?? undefined);
  const { data, error: sendError } = await new Resend(env.RESEND_API_KEY).emails.send(
    { from, to: [ctx.recipient], subject: email.subject, html: email.html, text: email.text, replyTo },
    // Same key for the same claim: a network retry can't produce a second copy.
    { idempotencyKey: `email-log-${id}-${ctx.attempt_count}` },
  );
  if (sendError || !data) return { status: "failed", error: sendError?.message ?? "Resend returned no message id." };
  return { status: "sent", providerId: data.id };
}
