import "server-only";

import { redirect } from "next/navigation";

import { can, type Permission } from "@/lib/auth/permissions";
import { AppError, friendlyMessage } from "@/lib/domain/errors";

import { getStaffSession, type StaffProfile } from "./session";

/** Only same-site admin paths may be used as a post-login destination. */
export function safeNextPath(value: string | null | undefined, fallback = "/admin"): string {
  if (!value || !value.startsWith("/admin") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (value.startsWith("/admin/login") || value.startsWith("/admin/auth")) return fallback;
  return value;
}

/** For Server Components: redirects to sign-in, or to an explanation, when not staff. */
export async function requireStaffPage(currentPath = "/admin"): Promise<StaffProfile> {
  const session = await getStaffSession();
  if (session.status === "signed_out") {
    redirect(`/admin/login?next=${encodeURIComponent(safeNextPath(currentPath))}`);
  }
  if (session.status === "no_access") redirect("/admin/login?error=no_access");
  return session.profile;
}

/** For Server Components that need a specific capability (e.g. Super Admin pages). */
export async function hasPermission(permission: Permission): Promise<boolean> {
  const session = await getStaffSession();
  return session.status === "staff" && can(session.actor, permission);
}

/**
 * For Server Actions: re-verifies the caller on every call. UI visibility is never
 * trusted; the database re-checks too (RLS / SECURITY DEFINER role checks).
 */
export async function assertPermission(permission: Permission): Promise<StaffProfile> {
  const session = await getStaffSession();
  if (session.status !== "staff" || !can(session.actor, permission)) {
    throw new AppError("forbidden", friendlyMessage("forbidden"));
  }
  return session.profile;
}
