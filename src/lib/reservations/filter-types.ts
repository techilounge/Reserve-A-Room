import type { LocalDate } from "@/lib/datetime";
import type { Enums } from "@/lib/supabase/database.types";

export const RESERVATION_SORTS = ["start_asc", "start_desc", "created_desc", "created_asc"] as const;
export type ReservationSort = (typeof RESERVATION_SORTS)[number];

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
