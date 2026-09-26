import "server-only";

import type { LocalDate } from "@/lib/datetime";
import type { ReservationFilters } from "@/lib/reservations/filter-types";
import type { Database, Enums, Tables } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Staff reads. All go through the signed-in user's session, so the database re-checks
 * staff status (RAR09) and RLS applies — independent of the page-level guards.
 */

type Fn = Database["public"]["Functions"];
type SeriesLink = { series_id: string | null; occurrence_date: string | null };
export type AdminReservationRow = Fn["admin_list_reservations"]["Returns"][number] & SeriesLink;
export type AdminReservation = Fn["admin_get_reservation"]["Returns"][number] & SeriesLink;
export type CalendarEntry = Fn["admin_calendar"]["Returns"][number] & SeriesLink;
export type EmailLogRow = Fn["admin_reservation_emails"]["Returns"][number];
export type DashboardCounts = Fn["admin_dashboard"]["Returns"][number];
export type ExportReservationRow = Fn["admin_export_reservations"]["Returns"][number];

export type ReservationSeriesOccurrence = {
  id: string;
  reference_code: string;
  occurrence_date: string;
  status: Enums<"reservation_status">;
  start_at: string;
  end_at: string;
};

export type ReservationSeriesDetail = {
  series: Tables<"reservation_series">;
  occurrences: ReservationSeriesOccurrence[];
  exceptions: Tables<"reservation_series_exceptions">[];
};

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function seriesLinks(supabase: ServerClient, ids: string[]): Promise<Map<string, SeriesLink>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc("admin_reservation_series_links", { p_ids: ids });
  if (error) throw error;
  return new Map(data.map((row) => [row.reservation_id, { series_id: row.series_id, occurrence_date: row.occurrence_date }]));
}

export type { ReservationFilters } from "@/lib/reservations/filter-types";

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
  const links = await seriesLinks(supabase, data.map((row) => row.id));
  const rows = data.map((row) => ({ ...row, ...(links.get(row.id) ?? { series_id: null, occurrence_date: null }) }));
  return { rows, total: Number(data[0]?.total_count ?? 0) };
}

export async function exportReservations(filters: ReservationFilters & { from: LocalDate; to: LocalDate }): Promise<ExportReservationRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_export_reservations", {
    p_from: filters.from,
    p_to: filters.to,
    p_search: filters.search || undefined,
    p_statuses: filters.statuses?.length ? filters.statuses : undefined,
    p_room_id: filters.roomId || undefined,
    p_ministry_id: filters.ministryId || undefined,
    p_approval: filters.approval || undefined,
    p_sort: filters.sort ?? "start_asc",
    p_limit: 1000,
  });
  if (error) throw error;
  return data;
}

export async function getReservation(id: string): Promise<AdminReservation | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_get_reservation", { p_id: id }).maybeSingle();
  if (error) {
    if (error.code === "RAR08" || error.code === "22P02") return null;
    throw error;
  }
  if (!data) return null;
  const links = await seriesLinks(supabase, [data.id]);
  return { ...data, ...(links.get(data.id) ?? { series_id: null, occurrence_date: null }) };
}

export async function getReservationSeries(id: string): Promise<ReservationSeriesDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_get_reservation_series", { p_id: id });
  if (error) {
    if (error.code === "RAR08" || error.code === "22P02") return null;
    throw error;
  }
  return data as unknown as ReservationSeriesDetail;
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
  const links = await seriesLinks(supabase, data.map((row) => row.id));
  return data.map((row) => ({ ...row, ...(links.get(row.id) ?? { series_id: null, occurrence_date: null }) }));
}

export async function getReservationEmails(id: string): Promise<EmailLogRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_reservation_emails", { p_id: id });
  if (error) throw error;
  return data;
}
