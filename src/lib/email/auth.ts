import "server-only";

import { createHash } from "node:crypto";

import { render } from "@react-email/render";
import { Resend } from "resend";

import { buildAuthEmail, type AuthEmailKind } from "@/emails/auth-templates";
import { getAppUrl } from "@/lib/app-url";
import { getServerEnv, isProductionDeployment } from "@/lib/env/server";
import { site } from "@/lib/site";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { formatFrom } from "./address";

type Service = ReturnType<typeof createSupabaseServiceClient>;

export type AuthEmailResult = { ok: true; providerId?: string } | { ok: false; error: string };

/**
 * Delivers invitation and recovery links through the same branded Resend channel as
 * reservation notifications. Supabase generates/verifies the one-time token, but never
 * sends the message.
 */
export async function sendAuthEmail(options: {
  kind: AuthEmailKind;
  to: string;
  fullName?: string | null;
  actionUrl: string;
  service?: Service;
}): Promise<AuthEmailResult> {
  const service = options.service ?? createSupabaseServiceClient();
  const { data: settings, error: settingsError } = await service
    .from("app_settings")
    .select("app_name, church_name, contact_email, contact_phone, email_sender_name")
    .single();

  if (settingsError) {
    console.error("[auth-email] failed to load branding settings", settingsError.message);
  }

  const appUrl = getAppUrl().origin;
  const recipientFirstName = firstName(options.fullName, options.to);
  const { subject, element } = buildAuthEmail(options.kind, {
    appUrl,
    appName: settings?.app_name ?? site.appName,
    churchName: settings?.church_name ?? site.churchName,
    contactEmail: settings?.contact_email ?? null,
    contactPhone: settings?.contact_phone ?? null,
    recipientFirstName,
    actionUrl: options.actionUrl,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  const env = getServerEnv();
  const from = env.RESEND_FROM_EMAIL
    ? formatFrom(settings?.email_sender_name ?? site.appName, env.RESEND_FROM_EMAIL)
    : null;
  if (!env.RESEND_API_KEY || !from) {
    const error = "Email delivery is not configured (RESEND_API_KEY and RESEND_FROM_EMAIL).";
    if (!isProductionDeployment()) {
      console.info(`[auth-email] skipped (${error})\n  to: ${options.to}\n  subject: ${subject}\n${text}`);
    }
    return { ok: false, error };
  }

  const digest = createHash("sha256").update(`${options.kind}\0${options.to}\0${options.actionUrl}`).digest("hex").slice(0, 32);
  const { data, error } = await new Resend(env.RESEND_API_KEY).emails.send(
    {
      from,
      to: [options.to],
      subject,
      html,
      text,
      replyTo: env.RESEND_REPLY_TO ?? settings?.contact_email ?? undefined,
    },
    { idempotencyKey: `auth-${options.kind}-${digest}` },
  );

  if (error || !data) return { ok: false, error: error?.message ?? "Resend returned no message id." };
  return { ok: true, providerId: data.id };
}

function firstName(fullName: string | null | undefined, email: string): string {
  const first = fullName?.trim().split(/\s+/)[0];
  if (first) return first;
  return email.split("@")[0] || "there";
}
