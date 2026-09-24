import { DoorClosed } from "lucide-react";
import type { Metadata } from "next";

import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { ReservationWizard } from "@/components/reserve/reservation-wizard";
import type { ReservePrefill, ReserveRoom } from "@/components/reserve/types";
import { compareLocalDates, isLocalDate, isLocalTime, todayInZone } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { horizonDate } from "@/lib/domain/rooms/advance-booking";

// "Today" and each room's horizon must be computed per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserve a Room",
  description: "Reserve a room at Stonehill SDA Church for your ministry meeting, activity, rehearsal or event.",
};

export default async function ReservePage({ searchParams }: PageProps<"/reserve">) {
  const raw = await searchParams;
  const catalog = await loadCatalog();

  const header = (
    <PageHeader
      title="Reserve a Room"
      description="Choose a room and time, tell us about your reservation, then review and submit. No account needed."
    />
  );

  if (!catalog.ok) {
    return (
      <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
        {header}
        <CatalogUnavailable reason={catalog.reason} />
      </div>
    );
  }

  const { settings, ministries } = catalog.catalog;
  const today = todayInZone(settings.timeZone);
  const rooms: ReserveRoom[] = catalog.catalog.rooms
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
    }));

  if (rooms.length === 0) {
    return (
      <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
        {header}
        <EmptyState icon={DoorClosed} title="No rooms are open for reservations right now">
          Please check back soon or contact the church office.
        </EmptyState>
      </div>
    );
  }

  // Pre-fill from links like /reserve?room=conference-room&date=2026-10-01&start=09:00
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const room = rooms.find((r) => r.slug === one(raw.room));
  const date = one(raw.date);
  const validDate =
    room && date && isLocalDate(date) && compareLocalDates(date, today) >= 0 && compareLocalDates(date, room.horizon) <= 0
      ? date
      : undefined;
  const start = one(raw.start);
  const end = one(raw.end);
  const prefill: ReservePrefill = {
    roomId: room?.id,
    date: validDate,
    start: validDate && start && isLocalTime(start) ? start : undefined,
    end: validDate && end && isLocalTime(end) ? end : undefined,
  };

  return (
    <div className="page-container flex max-w-3xl flex-col gap-8 py-10 sm:py-14">
      {header}
      <ReservationWizard
        rooms={rooms}
        ministries={ministries}
        settings={{
          timeZone: settings.timeZone,
          dayStart: settings.dayStart,
          dayEnd: settings.dayEnd,
          intervalMinutes: settings.intervalMinutes,
          leadMinutes: settings.leadMinutes,
        }}
        today={today}
        prefill={prefill}
      />
    </div>
  );
}
