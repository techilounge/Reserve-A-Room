import "server-only";

import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Fn = Database["public"]["Functions"];
export type AdminRoom = Fn["admin_list_rooms"]["Returns"][number];
export type AdminAmenity = Fn["admin_list_amenities"]["Returns"][number];
export type AdminMinistry = Fn["admin_list_ministries"]["Returns"][number];
export type AdminUser = Fn["admin_list_users"]["Returns"][number];
export type AuditEntry = Fn["admin_audit_log"]["Returns"][number];
export type AdminSettings = Fn["get_admin_settings"]["Returns"];

async function rpc<T>(call: (s: Awaited<ReturnType<typeof createSupabaseServerClient>>) => PromiseLike<{ data: T | null; error: unknown }>) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await call(supabase);
  if (error) throw error;
  return data as T;
}

export const listRooms = () => rpc<AdminRoom[]>((s) => s.rpc("admin_list_rooms"));
export const listAmenities = () => rpc<AdminAmenity[]>((s) => s.rpc("admin_list_amenities"));
export const listMinistries = () => rpc<AdminMinistry[]>((s) => s.rpc("admin_list_ministries"));
export const listUsers = () => rpc<AdminUser[]>((s) => s.rpc("admin_list_users"));
export const getAdminSettings = () => rpc<AdminSettings>((s) => s.rpc("get_admin_settings"));

export async function getAuditLog(filters: { search?: string; entityType?: string; page: number; pageSize: number }) {
  const rows = await rpc<AuditEntry[]>((s) =>
    s.rpc("admin_audit_log", {
      p_search: filters.search || undefined,
      p_entity_type: filters.entityType || undefined,
      p_limit: filters.pageSize,
      p_offset: (filters.page - 1) * filters.pageSize,
    }),
  );
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}
