import type { LocalDate, LocalTime } from "@/lib/datetime";
import type { AdvanceRule } from "@/lib/domain/rooms/advance-booking";

/** Serializable room data passed from the server page to the reservation form. */
export type ReserveRoom = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  capacity: number;
  approvalRequired: boolean;
  foodDrinksAllowed: boolean;
  advance: AdvanceRule;
  /** Last selectable date for this room (computed on the server from today). */
  horizon: LocalDate;
};

export type ReserveSettings = {
  timeZone: string;
  dayStart: LocalTime;
  dayEnd: LocalTime;
  intervalMinutes: number;
  leadMinutes: number;
};

export type ReservePrefill = {
  roomId?: string;
  date?: LocalDate;
  start?: LocalTime;
  end?: LocalTime;
};
