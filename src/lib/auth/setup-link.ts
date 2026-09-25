import type { EmailOtpType } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/app-url";

export type PasswordSetupOtpType = Extract<EmailOtpType, "invite" | "recovery">;

export function isPasswordSetupOtpType(value: unknown): value is PasswordSetupOtpType {
  return value === "invite" || value === "recovery";
}

/** Builds the app-owned landing URL for a Supabase one-time auth token. */
export function authSetupUrl(tokenHash: string, type: PasswordSetupOtpType): string {
  const link = new URL("/admin/auth/confirm", getAppUrl());
  link.searchParams.set("token_hash", tokenHash);
  link.searchParams.set("type", type);
  link.searchParams.set("next", "/admin/set-password");
  return link.toString();
}
