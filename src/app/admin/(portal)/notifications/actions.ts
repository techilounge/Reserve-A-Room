"use server";

import { revalidatePath } from "next/cache";

import { getStaffSession } from "@/lib/auth/session";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type NotificationItem = Database["public"]["Functions"]["my_notifications"]["Returns"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unread count + latest items for the header bell. Empty for non-staff. */
export async function getNotificationSummary(): Promise<{ unread: number; latest: NotificationItem[] }> {
  const session = await getStaffSession();
  if (session.status !== "staff") return { unread: 0, latest: [] };
  const supabase = await createSupabaseServerClient();
  const [count, list] = await Promise.all([
    supabase.rpc("unread_notification_count"),
    supabase.rpc("my_notifications", { p_limit: 8 }),
  ]);
  if (count.error || list.error) {
    console.error("[notifications] summary failed", count.error ?? list.error);
    return { unread: 0, latest: [] };
  }
  return { unread: count.data ?? 0, latest: list.data };
}

/** Marks the given notifications (or all, when no ids) as read for the current user. */
export async function markNotificationsRead(ids?: string[]): Promise<{ ok: boolean }> {
  const session = await getStaffSession();
  if (session.status !== "staff") return { ok: false };
  const safeIds = ids?.filter((id) => UUID.test(id)).slice(0, 100);
  if (ids && !safeIds?.length) return { ok: true };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: safeIds });
  if (error) {
    console.error("[notifications] mark read failed", error);
    return { ok: false };
  }
  revalidatePath("/admin/notifications");
  return { ok: true };
}
