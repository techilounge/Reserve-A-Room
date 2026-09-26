import "server-only";

import { render } from "@react-email/render";
import { Resend } from "resend";

import {
  buildSystemEmail,
  isSystemEmailEvent,
  type AdminFirstLoginEmailData,
  type RecurringSeriesEmailData,
} from "@/emails/system-templates";
import { getAppUrl } from "@/lib/app-url";
import {
  formatLongDate,
  formatTimeRange,
  normalizeTime,
  formatInstant,
  type LocalDate,
} from "@/lib/datetime";
import { getServerEnv, isProductionDeployment } from "@/lib/env/server";
import { recurrenceRuleFromStorage, recurrenceRuleLabel } from "@/lib/recurrence/preview";
import type { MonthlyOrdinal, Weekday } from "@/lib/recurrence/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { formatFrom } from "./address";

type Outcome = "sent" | "failed" | "skipped";
type Service = ReturnType<typeof createSupabaseServiceClient>;

type SystemEmailContext = {
  email_id: string;
  recipient: string;
  event_type: string;
  attempt_count: number;
  payload: { accepted_at?: string };
  settings: {
    app_name: string;
    church_name: string;
    contact_email: string | null;
    contact_phone: string | null;
    email_sender_name: string | null;
    timezone: string;
  };
  series: {
    id: string;
    frequency: string;
    interval_count: number;
    weekdays: Weekday[];
    weekday: Weekday | null;
    month_ordinals: MonthlyOrdinal[];
    month_ordinal: MonthlyOrdinal | null;
    day_of_month: number | null;
    month_of_year: number | null;
    start_date: LocalDate;
    end_date: LocalDate | null;
    local_start_time: string;
    local_end_time: string;
    requester_first_name: string;
  } | null;
  room: { name: string } | null;
  user: {
    id: string;
    full_name: string;
    email: string;
    role: "admin" | "super_admin";
    invitation_accepted_at: string | null;
  } | null;
  occurrences: { occurrence_date: LocalDate }[];
};

export async function deliverQueuedSystemEmails(options: { entityId?: string; limit?: number } = {}) {
  const supabase = createSupabaseServiceClient();
  const { data: ids, error } = await supabase.rpc("claim_system_emails", {
    p_limit: options.limit ?? 20,
    p_entity_id: options.entityId,
  });
  if (error) throw error;

  const totals: Record<Outcome, number> = { sent: 0, failed: 0, skipped: 0 };
  for (const id of ids ?? []) totals[await deliverOne(supabase, id)] += 1;
  return totals;
}

async function deliverOne(supabase: Service, id: string): Promise<Outcome> {
  let outcome: { status: Outcome; providerId?: string; error?: string };
  try {
    outcome = await send(supabase, id);
  } catch (error) {
    console.error("[system-email] delivery failed", id, error);
    outcome = { status: "failed", error: error instanceof Error ? error.message : "Unexpected error while sending." };
  }

  const { error } = await supabase.rpc("complete_system_email", {
    p_id: id,
    p_status: outcome.status,
    p_provider_message_id: outcome.providerId,
    p_error: outcome.error,
  });
  if (error) console.error("[system-email] could not record result", id, error);
  return outcome.status;
}

async function send(supabase: Service, id: string): Promise<{ status: Outcome; providerId?: string; error?: string }> {
  const { data, error } = await supabase.rpc("system_email_context", { p_email_id: id });
  if (error) throw error;
  const ctx = data as SystemEmailContext | null;
  if (!ctx) return { status: "failed", error: "The email context no longer exists." };
  if (!isSystemEmailEvent(ctx.event_type)) return { status: "failed", error: `Unknown system email type: ${ctx.event_type}` };

  const appUrl = getAppUrl().origin;
  const brand = {
    appUrl,
    appName: ctx.settings.app_name,
    churchName: ctx.settings.church_name,
    contactEmail: ctx.settings.contact_email,
    contactPhone: ctx.settings.contact_phone,
  };
  let emailData: RecurringSeriesEmailData | AdminFirstLoginEmailData;
  if (ctx.event_type === "admin_first_login") {
    if (!ctx.user) return { status: "failed", error: "The administrator email context no longer exists." };
    emailData = {
      ...brand,
      fullName: ctx.user.full_name,
      email: ctx.user.email,
      role: ctx.user.role === "super_admin" ? "Super Admin" : "Admin",
      acceptedAt: formatInstant(
        ctx.user.invitation_accepted_at ?? ctx.payload.accepted_at ?? new Date(),
        ctx.settings.timezone,
      ),
      usersUrl: `${appUrl}/admin/users`,
    };
  } else {
    if (!ctx.series || !ctx.room) return { status: "failed", error: "The recurring series email context no longer exists." };
    const rule = recurrenceRuleFromStorage(ctx.series);
    const shown = ctx.occurrences.slice(0, 12).map((occurrence) => formatLongDate(occurrence.occurrence_date));
    if (ctx.occurrences.length > shown.length) shown.push(`…and ${ctx.occurrences.length - shown.length} more`);
    emailData = {
      ...brand,
      requesterFirstName: ctx.series.requester_first_name,
      roomName: ctx.room.name,
      schedule: `${rule ? recurrenceRuleLabel(rule) : "Recurring schedule"}, ${formatTimeRange(normalizeTime(ctx.series.local_start_time), normalizeTime(ctx.series.local_end_time))}`,
      starts: formatLongDate(ctx.series.start_date),
      ends: ctx.series.end_date ? formatLongDate(ctx.series.end_date) : "After one year or 50 instances",
      occurrenceCount: ctx.occurrences.length,
      occurrenceSummary: shown.join("\n"),
    };
  }
  const built = buildSystemEmail(ctx.event_type, emailData);
  const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);

  const env = getServerEnv();
  const from = env.RESEND_FROM_EMAIL ? formatFrom(ctx.settings.email_sender_name, env.RESEND_FROM_EMAIL) : null;
  if (!env.RESEND_API_KEY || !from) {
    const problem = "Email delivery is not configured (RESEND_API_KEY and RESEND_FROM_EMAIL).";
    if (isProductionDeployment()) return { status: "failed", error: problem };
    console.info(`[system-email] skipped (${problem})\n  to: ${ctx.recipient}\n  subject: ${built.subject}\n${text}`);
    return { status: "skipped" };
  }

  const { data: sent, error: sendError } = await new Resend(env.RESEND_API_KEY).emails.send(
    {
      from,
      to: [ctx.recipient],
      subject: built.subject,
      html,
      text,
      replyTo: env.RESEND_REPLY_TO ?? ctx.settings.contact_email ?? undefined,
    },
    { idempotencyKey: `system-email-log-${id}-${ctx.attempt_count}` },
  );
  if (sendError || !sent) return { status: "failed", error: sendError?.message ?? "Resend returned no message id." };
  return { status: "sent", providerId: sent.id };
}
