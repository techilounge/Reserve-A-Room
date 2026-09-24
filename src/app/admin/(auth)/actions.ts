"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/guards";
import { getAppUrl } from "@/lib/app-url";
import { hitRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailField } from "@/lib/validation/text";

export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Echoed back so the email field survives React's automatic form reset after an error. */
  email?: string;
};

const GENERIC_SIGN_IN_ERROR = "That email and password don't match an administrator account.";

export async function signIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "").slice(0, 320);
  const parsed = z
    .object({ email: emailField, password: z.string().min(1).max(200) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { status: "error", message: "Please enter your email and password.", email };

  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([
    hitRateLimit(RATE_LIMITS.loginPerIp, ip),
    hitRateLimit(RATE_LIMITS.loginPerEmail, parsed.data.email),
  ]);
  if (!ipOk || !emailOk) return { status: "error", message: "Too many sign-in attempts. Please wait a few minutes.", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "error", message: GENERIC_SIGN_IN_ERROR, email };

  const { data: profile } = await supabase.rpc("current_staff_profile").maybeSingle();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { status: "error", message: "This account doesn't have access to Reserve-A-Room administration.", email };
  }

  redirect(safeNextPath(String(form.get("next") ?? "")));
}

export async function requestPasswordReset(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = emailField.safeParse(form.get("email"));
  if (!parsed.success) {
    return { status: "error", message: "Please enter a valid email address.", email: String(form.get("email") ?? "").slice(0, 320) };
  }

  // Same response whether or not the account exists, so emails can't be probed.
  const success: AuthFormState = {
    status: "success",
    message: "If that email belongs to an administrator, a password reset link is on its way.",
  };
  if (!(await hitRateLimit(RATE_LIMITS.passwordResetPerIp, await clientIp()))) return success;

  const supabase = await createSupabaseServerClient();
  const redirectTo = new URL("/admin/auth/confirm?next=/admin/set-password", getAppUrl()).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo });
  if (error) console.error("[auth] password reset request failed", error.message);
  return success;
}

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Use at least 10 characters.")
      .max(200)
      .regex(/[A-Za-z]/, "Include at least one letter.")
      .regex(/\d/, "Include at least one number."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match." });

export async function setPassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = passwordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Please check your password." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Your link has expired. Please request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[auth] password update failed", error.message);
    return {
      status: "error",
      message: error.code === "same_password" ? "Please choose a password you haven't used before." : "We couldn't update your password. Please try again.",
    };
  }
  redirect("/admin");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login?signed_out=1");
}
