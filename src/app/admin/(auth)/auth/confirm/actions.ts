"use server";

import { redirect } from "next/navigation";

import { isPasswordSetupOtpType } from "@/lib/auth/setup-link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Exchanges the one-time token only after a person explicitly submits the form.
 * Keeping token consumption out of GET prevents email security scanners from using
 * invitation and recovery links before the recipient opens them.
 */
export async function confirmPasswordSetup(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = formData.get("type");
  if (!tokenHash || !isPasswordSetupOtpType(type)) {
    redirect("/admin/auth/confirm?error=invalid_link");
  }

  let verified = false;
  let errorCode = "link_expired";
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    verified = !error;
    if (error) console.error("[auth] password-setup token verification failed", error.message);
  } catch (error) {
    errorCode = "configuration";
    console.error("[auth] password-setup confirmation could not reach Supabase", error);
  }

  if (verified) redirect("/admin/set-password");
  redirect(`/admin/auth/confirm?error=${errorCode}`);
}
