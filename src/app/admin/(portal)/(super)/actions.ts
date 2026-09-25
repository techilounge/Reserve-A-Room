"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { assertPermission } from "@/lib/auth/guards";
import { authSetupUrl } from "@/lib/auth/setup-link";
import { getAppUrl } from "@/lib/app-url";
import { CATALOG_TAG } from "@/lib/data/catalog";
import { sendAuthEmail } from "@/lib/email/auth";
import { toAppError } from "@/lib/domain/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { amenitySchema, inviteSchema, ministrySchema, roomSchema, settingsSchema } from "@/lib/validation/super";

export type SuperActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown): SuperActionResult {
  const appError = toAppError(error);
  if (appError.kind === "unexpected") console.error("[super-admin] action failed", error);
  return { ok: false, message: appError.message };
}

function flatten(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Room/ministry/settings changes must show on public pages immediately. */
function refreshCatalog(paths: string[]) {
  updateTag(CATALOG_TAG);
  for (const path of paths) revalidatePath(path);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export async function saveRoomAction(input: unknown): Promise<SuperActionResult> {
  try {
    await assertPermission("rooms.manage");
  } catch (error) {
    return fail(error);
  }
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: flatten(parsed.error.issues) };
  const r = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("save_room", {
    p_id: r.id ?? undefined,
    p_name: r.name,
    p_slug: r.slug,
    p_capacity: r.capacity,
    p_approval_required: r.approvalRequired,
    p_food_drinks_allowed: r.foodDrinksAllowed,
    p_active: r.active,
    p_reservable: r.reservable,
    p_sort_order: r.sortOrder,
    p_amenity_ids: r.amenityIds,
    p_description: r.description || undefined,
    p_location: r.location || undefined,
    p_unavailable_message: r.unavailableMessage || undefined,
    p_max_advance_value: r.useDefaultAdvance ? undefined : r.advanceValue,
    p_max_advance_unit: r.useDefaultAdvance ? undefined : r.advanceUnit,
  });
  if (error) {
    const result = fail(error);
    if (error.code === "23505" && !result.ok) result.fieldErrors = { slug: "Another room already uses this web address." };
    return result;
  }
  refreshCatalog(["/admin/rooms", `/rooms/${r.slug}`]);
  if (!r.id) redirect(`/admin/rooms/${id}?created=1`);
  return { ok: true, message: "Room saved.", id: id ?? undefined };
}

export async function setRoomImageAction(roomId: string, imagePath: string | null): Promise<SuperActionResult> {
  try {
    await assertPermission("rooms.manage");
  } catch (error) {
    return fail(error);
  }
  if (!UUID.test(roomId)) return { ok: false, message: "Room not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_room_image", { p_id: roomId, p_image_path: imagePath ?? undefined });
  if (error) return fail(error);
  refreshCatalog(["/admin/rooms"]);
  return { ok: true, message: imagePath ? "Photo updated." : "Photo removed." };
}

export async function createAmenityAction(input: unknown): Promise<SuperActionResult> {
  try {
    await assertPermission("rooms.manage");
  } catch (error) {
    return fail(error);
  }
  const parsed = amenitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the amenity." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_amenity", {
    p_name: parsed.data.name,
    p_icon: parsed.data.icon,
  });
  if (error) return fail(error);
  refreshCatalog([]);
  return { ok: true, message: "Amenity added.", id: data ?? undefined };
}

// ---------------------------------------------------------------------------
// Ministries
// ---------------------------------------------------------------------------

export async function saveMinistryAction(input: unknown): Promise<SuperActionResult> {
  try {
    await assertPermission("ministries.manage");
  } catch (error) {
    return fail(error);
  }
  const parsed = ministrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the ministry." };
  const m = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_ministry", {
    p_id: m.id ?? undefined,
    p_name: m.name,
    p_active: m.active,
    p_sort_order: m.sortOrder,
  });
  if (error) {
    return error.code === "23505" ? { ok: false, message: "A ministry with that name already exists." } : fail(error);
  }
  refreshCatalog(["/admin/ministries"]);
  return { ok: true, message: m.id ? "Ministry updated." : "Ministry added." };
}

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export async function inviteUserAction(input: unknown): Promise<SuperActionResult> {
  try {
    await assertPermission("users.manage");
  } catch (error) {
    return fail(error);
  }
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: flatten(parsed.error.issues) };
  const { fullName, email, role } = parsed.data;

  // Creating auth users requires the Auth admin API (service role). The profile — which
  // is what actually grants access — is created by the Super Admin's own session, so the
  // database re-checks their role.
  const service = createSupabaseServiceClient();
  const redirectTo = new URL("/admin/auth/confirm?next=/admin/set-password", getAppUrl()).toString();
  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return fail(error);
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 1000) break;
  }

  const linkType = userId ? "recovery" : "invite";
  const { data: link, error: linkError } = await service.auth.admin.generateLink(
    linkType === "invite"
      ? { type: "invite", email, options: { redirectTo, data: { full_name: fullName } } }
      : { type: "recovery", email, options: { redirectTo } },
  );
  if (linkError) {
    console.error("[super-admin] invite link generation failed", linkError);
    return { ok: false, message: "The invitation couldn't be created. Please check the email address and try again." };
  }
  userId = link.user.id;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_staff_profile", { p_user_id: userId, p_full_name: fullName, p_role: role });
  if (error) {
    return error.code === "RAR10" ? { ok: false, message: "That person already has an administrator account." } : fail(error);
  }
  const delivered = await sendAuthEmail({
    kind: "invitation",
    to: email,
    fullName,
    actionUrl: authSetupUrl(link.properties.hashed_token, linkType),
    service,
  });
  revalidatePath("/admin/users");
  if (!delivered.ok) {
    console.error("[super-admin] invitation email failed", delivered.error);
    return {
      ok: false,
      message: `The administrator account was created, but its email couldn't be sent. Ask ${email} to use Forgot password after email delivery is configured.`,
    };
  }
  return { ok: true, message: `Branded invitation sent to ${email} through Resend.` };
}

export async function setUserRoleAction(userId: string, role: "admin" | "super_admin"): Promise<SuperActionResult> {
  try {
    await assertPermission("roles.assign");
  } catch (error) {
    return fail(error);
  }
  if (!UUID.test(userId) || (role !== "admin" && role !== "super_admin")) return { ok: false, message: "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_user_role", { p_user_id: userId, p_role: role });
  if (error) return fail(error);
  revalidatePath("/admin", "layout");
  return { ok: true, message: role === "super_admin" ? "Now a Super Admin." : "Now an Admin." };
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<SuperActionResult> {
  try {
    await assertPermission("users.manage");
  } catch (error) {
    return fail(error);
  }
  if (!UUID.test(userId)) return { ok: false, message: "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_user_active", { p_user_id: userId, p_active: active });
  if (error) return fail(error);

  // Access is already revoked by the profile flag (checked on every request and by RLS).
  // Banning the auth user also stops them from signing in or refreshing a session.
  const { error: banError } = await createSupabaseServiceClient().auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) console.error("[super-admin] auth ban update failed", banError.message);

  revalidatePath("/admin/users");
  return { ok: true, message: active ? "Account re-enabled." : "Account disabled." };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettingsAction(input: unknown): Promise<SuperActionResult> {
  try {
    await assertPermission("settings.manage");
  } catch (error) {
    return fail(error);
  }
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: flatten(parsed.error.issues) };
  const s = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_app_settings", {
    p_church_name: s.churchName,
    p_app_name: s.appName,
    p_timezone: s.timezone,
    p_booking_interval_minutes: s.bookingIntervalMinutes,
    p_default_max_advance_value: s.defaultAdvanceValue,
    p_default_max_advance_unit: s.defaultAdvanceUnit,
    p_min_lead_time_minutes: s.minLeadTimeMinutes,
    p_bookable_day_start: s.bookableDayStart,
    p_bookable_day_end: s.bookableDayEnd,
    p_allow_guest_cancellation: s.allowGuestCancellation,
    p_extra_admin_notification_emails: s.extraRecipients,
    p_email_sender_name: s.emailSenderName,
    p_contact_email: s.contactEmail || undefined,
    p_contact_phone: s.contactPhone || undefined,
  });
  if (error) return fail(error);
  refreshCatalog(["/admin/settings"]);
  return { ok: true, message: "Settings saved." };
}
