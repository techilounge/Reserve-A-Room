import "server-only";

import type { ReserveRoom, ReserveSettings } from "@/components/reserve/types";
import { todayInZone, type LocalDate } from "@/lib/datetime";
import type { Catalog } from "@/lib/data/catalog";
import { horizonDate } from "@/lib/domain/rooms/advance-booking";

/** Serializable room/settings context for the guest and staff reservation forms. */
export function reserveContext(catalog: Catalog): { rooms: ReserveRoom[]; settings: ReserveSettings; today: LocalDate } {
  const { settings } = catalog;
  const today = todayInZone(settings.timeZone);
  return {
    today,
    settings: {
      timeZone: settings.timeZone,
      dayStart: settings.dayStart,
      dayEnd: settings.dayEnd,
      intervalMinutes: settings.intervalMinutes,
      leadMinutes: settings.leadMinutes,
    },
    rooms: catalog.rooms
      .filter((r) => r.reservable)
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        location: r.location,
        capacity: r.capacity,
        approvalRequired: r.approvalRequired,
        foodDrinksAllowed: r.foodDrinksAllowed,
        advance: r.advance,
        horizon: horizonDate(today, r.advance),
      })),
  };
}
