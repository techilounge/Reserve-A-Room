import "server-only";

import type { LocalDate } from "@/lib/datetime";
import type { Database, Enums } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Staff reads. All go through the signed-in user's session, so the database re-checks
 * staff status (RAR09) and RLS applies — independent of the page-level guards.
 */

type Fn = Database["public"]["Functions"];
export type AdminReservationRow = Fn["admin_list_reservations"]["Returns"][number];
export type AdminReservation = Fn["admin_get_reservation"]["Returns"][number];
export type CalendarEntry = Fn["admin_calendar"]["Returns"][number];
export type EmailLogRow = Fn["admin_reservation_emails"]["Returns"][number];
export type DashboardCounts = Fn["admin_dashboard"]["Returns"][number];

export const SORTS = ["start_asc", "start_desc", "created_desc", "created_asc"] as const;
export type ReservationSort = (typeof SORTS)[number];

export type ReservationFilters = {
  search?: string;
  statuses?: Enums<"reservation_status">[];
  roomId?: string;
  ministryId?: string;
  from?: LocalDate;
  to?: LocalDate;
  approval?: "required" | "instant";
  sort?: ReservationSort;
  page?: number;
  pageSize?: number;
};

export async function listReservations(filters: ReservationFilters): Promise<{ rows: AdminReservationRow[]; total: number }> {
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_reservations", {
    p_search: filters.search || undefined,
    p_statuses: filters.statuses?.length ? filters.statuses : undefined,
    p_room_id: filters.roomId || undefined,
    p_ministry_id: filters.ministryId || undefined,
    p_from: filters.from || undefined,
    p_to: filters.to || undefined,
    p_approval: filters.approval || undefined,
    p_sort: filters.sort ?? "start_asc",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw error;
  return { rows: data, total: Number(data[0]?.total_count ?? 0) };
}

export async function getReservation(id: string): Promise<AdminReservation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_get_reservation", { p_id: id }).maybeSingle();
  if (error) {
    if (error.code === "RAR08" || error.code === "22P02") return null;
    throw error;
  }
  return data;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_dashboard").single();
  if (error) throw error;
  return data;
}

export async function getCalendar(
  from: LocalDate,
  to: LocalDate,
  options: { roomId?: string; includeCancelled?: boolean } = {},
): Promise<CalendarEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_calendar", {
    p_from: from,
    p_to: to,
    p_room_id: options.roomId || undefined,
    p_include_cancelled: options.includeCancelled ?? false,
  });
  if (error) throw error;
  return data;
}

export async function getReservationEmails(id: string): Promise<EmailLogRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_reservation_emails", { p_id: id });
  if (error) throw error;
  return data;
}
