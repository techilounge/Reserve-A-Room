import "server-only";

import { auditEntryMatchesSearch } from "@/lib/audit-format";
import type { Database, Tables } from "@/lib/supabase/database.types";
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

export async function getRecurringReservationRequests(page: number, pageSize: number) {
  const supabase = await createSupabaseServerClient();
  const from = (page - 1) * pageSize;
  const { data, error, count } = await supabase
    .from("recurring_reservation_requests")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data as Tables<"recurring_reservation_requests">[], total: count ?? 0 };
}

function isMissingRoomImageGalleryRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  if (code === "42883" || code === "PGRST202") return true;
  const normalizedMessage = message?.toLowerCase() ?? "";
  return normalizedMessage.includes("admin_room_image_paths") &&
    (normalizedMessage.includes("does not exist") || normalizedMessage.includes("could not find the function"));
}

export async function getRoomImagePaths(roomId: string, legacyImagePath: string | null = null): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_room_image_paths", { p_room_id: roomId });
  if (error) {
    // Keep room editing available during the rollout window before the gallery migration lands.
    if (isMissingRoomImageGalleryRpc(error)) return legacyImagePath ? [legacyImagePath] : [];
    throw error;
  }
  return data ?? [];
}

export async function getAuditLog(filters: { search?: string; entityType?: string; from?: string; to?: string; page: number; pageSize: number }) {
  const supabase = await createSupabaseServerClient();
  const currentArgs = {
    p_search: filters.search || undefined,
    p_entity_type: filters.entityType || undefined,
    // Explicit nulls select the new six-argument RPC and make a pre-migration
    // schema-cache miss detectable even when no date filter is active.
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: filters.pageSize,
    p_offset: (filters.page - 1) * filters.pageSize,
  } as unknown as Fn["admin_audit_log"]["Args"];
  const current = await supabase.rpc("admin_audit_log", currentArgs);
  if (!current.error) {
    const rows = current.data as AuditEntry[];
    return { rows, total: Number(rows[0]?.total_count ?? 0) };
  }

  if (current.error.code !== "PGRST202") throw current.error;

  // Temporary rolling-deployment compatibility with the older four-argument
  // RPC. Fetch every chunk before filtering so search and pagination remain
  // global instead of depending on the page the administrator was viewing.
  const candidates: AuditEntry[] = [];
  const chunkSize = 200;
  let offset = 0;
  let available = 0;
  do {
    const legacy = await supabase.rpc("admin_audit_log", {
      p_search: undefined,
      p_entity_type: filters.entityType || undefined,
      p_limit: chunkSize,
      p_offset: offset,
    });
    if (legacy.error) throw legacy.error;
    const chunk = legacy.data as AuditEntry[];
    candidates.push(...chunk);
    available = Number(chunk[0]?.total_count ?? candidates.length);
    offset += chunk.length;
    if (chunk.length === 0) break;
  } while (offset < available);

  const filtered = candidates.filter((entry) => {
    const created = Date.parse(entry.created_at);
    if (filters.from && created < Date.parse(filters.from)) return false;
    if (filters.to && created >= Date.parse(filters.to)) return false;
    return auditEntryMatchesSearch(entry, filters.search ?? "");
  });
  const from = (filters.page - 1) * filters.pageSize;
  return { rows: filtered.slice(from, from + filters.pageSize), total: filtered.length };
}
