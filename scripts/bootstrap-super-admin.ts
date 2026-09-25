// One-time setup of the first Super Admin. There is deliberately NO web page for this.
//
//   1. Put these in .env.local (or export them in the shell):
//        NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//        NEXT_PUBLIC_APP_URL (e.g. https://reservearoom.stonehillchurch.org),
//        INITIAL_SUPER_ADMIN_EMAIL, optionally INITIAL_SUPER_ADMIN_NAME
//   2. npm run bootstrap:super-admin
//   3. Open the printed link (valid for a limited time) to choose a password.
//
// Safe to re-run: once a Super Admin exists it refuses to create another, but it will
// print a fresh password-setup link for that same person (e.g. if the first expired).
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { Resend } from "resend";

import type { Database } from "../src/lib/supabase/database.types.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`✖ Missing ${name}. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const appUrl = required("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
const email = required("INITIAL_SUPER_ADMIN_EMAIL").toLowerCase();
const fullName = process.env.INITIAL_SUPER_ADMIN_NAME?.trim() || email.split("@")[0];

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(target: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match || data.users.length < 1000) return match ?? null;
  }
}

function setupLink(hashedToken: string, type: "invite" | "recovery"): string {
  const link = new URL("/admin/auth/confirm", appUrl);
  link.searchParams.set("token_hash", hashedToken);
  link.searchParams.set("type", type);
  link.searchParams.set("next", "/admin/set-password");
  return link.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

async function sendSetupEmail(actionUrl: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return false;

  const safeName = escapeHtml(fullName.split(/\s+/)[0] || email.split("@")[0]);
  const safeUrl = escapeHtml(actionUrl);
  const logoUrl = `${appUrl}/branding/stonehill-logo-dark.png`;
  const subject = "Choose your Reserve-A-Room administrator password";
  const text = `Hi ${fullName.split(/\s+/)[0] || email.split("@")[0]},\n\nChoose a password for your Reserve-A-Room Super Admin account:\n${actionUrl}\n\nThis secure link expires soon and can be used only once.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#1b2433"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto"><tr><td style="background:#031e47;padding:24px 22px;border-radius:12px 12px 0 0"><img src="${escapeHtml(logoUrl)}" width="240" alt="Reserve-A-Room — Stonehill SDA Church" style="display:block;max-width:100%;height:auto"></td></tr><tr><td style="height:4px;background:#dea621"></td></tr><tr><td style="background:#fff;padding:28px 22px;border-radius:0 0 12px 12px"><h1 style="margin:0 0 16px;color:#031e47;font-size:22px">Choose your password</h1><p style="font-size:15px;line-height:24px">Hi ${safeName},</p><p style="font-size:15px;line-height:24px">Your Reserve-A-Room Super Admin account is ready. Choose a password to activate it.</p><p style="margin:22px 0"><a href="${safeUrl}" style="background:#031e47;color:#fff;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:600">Choose your password</a></p><p style="font-size:12px;line-height:18px;color:#566074">This secure link expires soon and can be used only once. Don’t forward this email.</p></td></tr></table></td></tr></table></body></html>`;
  const idempotencyKey = `bootstrap-${createHash("sha256").update(actionUrl).digest("hex").slice(0, 32)}`;
  const { error } = await new Resend(apiKey).emails.send(
    {
      from,
      to: [email],
      subject,
      html,
      text,
      replyTo: process.env.RESEND_REPLY_TO?.trim() || undefined,
    },
    { idempotencyKey },
  );
  if (error) {
    console.error(`✖ Resend could not deliver the password-setup email: ${error.message}`);
    return false;
  }
  return true;
}

async function main() {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("role", "super_admin")
    .eq("active", true);
  if (existingError) throw existingError;

  if (existing.length > 0 && !existing.some((p) => p.email === email)) {
    console.error("✖ A Super Admin already exists. Add more administrators from Users & Roles in the app.");
    process.exit(1);
  }

  const user = await findUserByEmail(email);
  const type = user ? "recovery" : "invite";
  const redirectTo = `${appUrl}/admin/set-password`;
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink(
    type === "invite" ? { type, email, options: { redirectTo } } : { type, email, options: { redirectTo } },
  );
  if (linkError) throw linkError;

  if (existing.length === 0) {
    const { error } = await supabase.rpc("bootstrap_first_super_admin", {
      p_user_id: link.user.id,
      p_full_name: fullName,
    });
    if (error) throw error;
    console.log(`✔ ${email} is now the first Super Admin.`);
  } else {
    console.log(`✔ ${email} is already the Super Admin. Generated a new password-setup link.`);
  }

  const actionUrl = setupLink(link.properties.hashed_token, type);
  if (await sendSetupEmail(actionUrl)) {
    console.log(`\n✔ Branded password-setup email sent to ${email} through Resend.`);
    console.log("  It expires soon; re-run this script if it does.\n");
  } else {
    console.log("\nOpen this link to choose a password (it expires soon; re-run this script if it does):\n");
    console.log(`  ${actionUrl}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`✖ Bootstrap failed: ${message}`);
  process.exit(1);
});
