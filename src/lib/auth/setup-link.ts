import type { EmailOtpType } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/app-url";

/** Builds the app-owned landing URL for a Supabase one-time auth token. */
export function authSetupUrl(tokenHash: string, type: Extract<EmailOtpType, "invite" | "recovery">): string {
  const link = new URL("/admin/auth/confirm", getAppUrl());
  link.searchParams.set("token_hash", tokenHash);
  link.searchParams.set("type", type);
  link.searchParams.set("next", "/admin/set-password");
  return link.toString();
}
