import {
  addDaysToLocalDate,
  compareLocalDates,
  isLocalDate,
  localDateToUtcMidnight,
  todayInZone,
  type LocalDate,
} from "@/lib/datetime";
import { RESERVATION_SORTS, type ReservationFilters } from "@/lib/reservations/filter-types";
import type { Enums } from "@/lib/supabase/database.types";

export const RESERVATION_STATUSES = ["pending", "approved", "declined", "cancelled"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPORT_MAX_DAYS = 365;

export type SearchParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function one(source: SearchParamSource, key: string): string {
  if (source instanceof URLSearchParams) return source.get(key) ?? "";
  return typeof source[key] === "string" ? source[key] : "";
}

function commonFilters(source: SearchParamSource): ReservationFilters {
  const status = one(source, "status");
  return {
    search: one(source, "q").trim().slice(0, 100),
    statuses:
      status === "upcoming"
        ? ["pending", "approved"]
        : (RESERVATION_STATUSES as readonly string[]).includes(status)
          ? [status as Enums<"reservation_status">]
          : undefined,
    roomId: UUID.test(one(source, "room")) ? one(source, "room") : undefined,
    ministryId: UUID.test(one(source, "ministry")) ? one(source, "ministry") : undefined,
    approval: one(source, "approval") === "required" || one(source, "approval") === "instant"
      ? (one(source, "approval") as "required" | "instant")
      : undefined,
    sort: (RESERVATION_SORTS as readonly string[]).includes(one(source, "sort"))
      ? (one(source, "sort") as ReservationFilters["sort"])
      : "start_asc",
  };
}

export function parseReservationListFilters(
  source: SearchParamSource,
  timeZone: string,
  pageSize = 25,
): ReservationFilters {
  const status = one(source, "status");
  return {
    ...commonFilters(source),
    from: isLocalDate(one(source, "from"))
      ? one(source, "from")
      : status === "upcoming"
        ? todayInZone(timeZone)
        : undefined,
    to: isLocalDate(one(source, "to")) ? one(source, "to") : undefined,
    page: Math.max(1, Number.parseInt(one(source, "page"), 10) || 1),
    pageSize,
  };
}

export type ExportFilters = ReservationFilters & { from: LocalDate; to: LocalDate; pageSize: number };

export function parseReservationExportFilters(
  source: SearchParamSource,
  timeZone: string,
): { ok: true; filters: ExportFilters } | { ok: false; message: string } {
  const common = commonFilters(source);
  const today = todayInZone(timeZone);
  const year = today.slice(0, 4);
  const rawFrom = one(source, "from");
  const rawTo = one(source, "to");
  let from: LocalDate;
  let to: LocalDate;

  if (rawFrom && !isLocalDate(rawFrom)) return { ok: false, message: "Choose a valid export start date." };
  if (rawTo && !isLocalDate(rawTo)) return { ok: false, message: "Choose a valid export end date." };

  if (isLocalDate(rawFrom) && isLocalDate(rawTo)) {
    from = rawFrom;
    to = rawTo;
  } else if (isLocalDate(rawFrom)) {
    from = rawFrom;
    to = addDaysToLocalDate(from, EXPORT_MAX_DAYS);
  } else if (isLocalDate(rawTo)) {
    to = rawTo;
    from = addDaysToLocalDate(to, -EXPORT_MAX_DAYS);
  } else {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  }

  if (one(source, "status") === "upcoming" && compareLocalDates(from, today) < 0) from = today;
  if (compareLocalDates(from, to) > 0) return { ok: false, message: "The export start date must be on or before the end date." };
  const days = Math.round((localDateToUtcMidnight(to).getTime() - localDateToUtcMidnight(from).getTime()) / 86_400_000);
  if (days > EXPORT_MAX_DAYS) {
    return { ok: false, message: "Exports are limited to a one-year date range. Choose a narrower range." };
  }

  return { ok: true, filters: { ...common, from, to, page: 1, pageSize: 1000 } };
}
