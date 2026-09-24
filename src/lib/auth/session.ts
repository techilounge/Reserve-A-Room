import "server-only";

import { cache } from "react";

import type { Actor, AppRole } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StaffProfile = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  emailNotifications: boolean;
};

export type StaffSession =
  | { status: "signed_out" }
  | { status: "no_access"; email: string | null }
  | { status: "staff"; profile: StaffProfile; actor: Actor };

/**
 * The signed-in user and their staff profile, verified with Supabase Auth (getUser
 * validates the JWT with the auth server — cookies alone are never trusted) and loaded
 * from the database. Cached per request.
 */
export const getStaffSession = cache(async (): Promise<StaffSession> => {
  if (!isSupabaseConfigured()) return { status: "signed_out" };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed_out" };

  const { data, error } = await supabase.rpc("current_staff_profile").maybeSingle();
  if (error) {
    console.error("[auth] failed to load staff profile", error);
    return { status: "no_access", email: user.email ?? null };
  }
  if (!data || !data.active) return { status: "no_access", email: user.email ?? null };

  const profile: StaffProfile = {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    active: data.active,
    emailNotifications: data.email_notifications,
  };
  return { status: "staff", profile, actor: { kind: "staff", role: profile.role, active: profile.active } };
});
