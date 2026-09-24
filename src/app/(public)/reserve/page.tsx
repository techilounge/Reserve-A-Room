import { DoorClosed } from "lucide-react";
import type { Metadata } from "next";

import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { ReservationWizard } from "@/components/reserve/reservation-wizard";
import type { ReservePrefill } from "@/components/reserve/types";
import { compareLocalDates, isLocalDate, isLocalTime } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { getTurnstileSiteKey } from "@/lib/env/public";
import { isTurnstileEnabled } from "@/lib/security/turnstile";
import { reserveContext } from "@/lib/reservations/reserve-context";

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

  const { ministries } = catalog.catalog;
  const { rooms, settings, today } = reserveContext(catalog.catalog);

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
        settings={settings}
        today={today}
        prefill={prefill}
        turnstileSiteKey={isTurnstileEnabled() ? getTurnstileSiteKey() : null}
      />
    </div>
  );
}
