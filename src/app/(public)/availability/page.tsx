import { CalendarX2, CircleAlert, CircleCheck, CircleX, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AvailabilityFilters } from "@/components/availability/availability-filters";
import { DayTimeline, reserveLink } from "@/components/availability/day-timeline";
import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { ApprovalBadge, CapacityBadge, FoodPolicyBadge } from "@/components/rooms/policy-badges";
import { Button } from "@/components/ui/button";
import { parseAvailabilityQuery, timeGrid, toSearch } from "@/lib/availability-query";
import { formatLongDate, formatTimeRange, timeZoneAbbreviation, todayInZone } from "@/lib/datetime";
import { getBusyBlocks } from "@/lib/data/availability";
import { loadCatalog, type PublicRoom } from "@/lib/data/catalog";
import { daySegments, isRangeAvailable, type BusyBlock, type DayWindow } from "@/lib/domain/availability";
import { advanceLabel, horizonDate, isWithinHorizon } from "@/lib/domain/rooms/advance-booking";

// Availability must always be current, whatever happened at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check Availability",
  description: "See when Stonehill SDA Church rooms are available before you reserve.",
};

export default async function AvailabilityPage({ searchParams }: PageProps<"/availability">) {
  const raw = await searchParams;
  const result = await loadCatalog();
  if (!result.ok) {
    return (
      <Shell>
        <CatalogUnavailable reason={result.reason} />
      </Shell>
    );
  }

  const { settings, rooms } = result.catalog;
  const tz = settings.timeZone;
  const today = todayInZone(tz);
  const grid = timeGrid(settings.dayStart, settings.dayEnd, settings.intervalMinutes);

  const selectedRoom = typeof raw.room === "string" ? rooms.find((r) => r.slug === raw.room) : undefined;
  const pickable = selectedRoom ? [selectedRoom] : rooms;
  const maxDate = pickable.reduce(
    (latest, room) => {
      const h = horizonDate(today, room.advance);
      return h > latest ? h : latest;
    },
    horizonDate(today, settings.defaultAdvance),
  );
  const query = parseAvailabilityQuery(raw, { today, maxDate, grid });
  if (!selectedRoom) query.room = "";

  const capacityFilter = query.capacity ? Number(query.capacity) : null;
  const shown = pickable.filter((room) => capacityFilter === null || room.capacity >= capacityFilter);
  const bookableIds = shown
    .filter((room) => room.reservable && isWithinHorizon(query.date, today, room.advance))
    .map((room) => room.id);

  let busy: Map<string, BusyBlock[]> | null = null;
  try {
    busy = await getBusyBlocks(bookableIds, query.date, 1, tz);
  } catch (error) {
    console.error("[availability] failed to load busy blocks", error);
  }

  const window: DayWindow = {
    date: query.date,
    timeZone: tz,
    dayStart: settings.dayStart,
    dayEnd: settings.dayEnd,
    intervalMinutes: settings.intervalMinutes,
    leadMinutes: settings.leadMinutes,
  };
  const largest = rooms.reduce((max, r) => Math.max(max, r.capacity), 0);

  return (
    <Shell>
      <AvailabilityFilters
        initial={query}
        rooms={rooms.map(({ slug, name, capacity }) => ({ slug, name, capacity }))}
        times={grid}
        minDate={today}
        maxDate={maxDate}
      />

      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-xl font-semibold">{formatLongDate(query.date)}</h2>
        <p className="text-sm text-muted-foreground">
          Times shown in church time ({timeZoneAbbreviation(tz)}). Details of other reservations are private.
        </p>
      </div>

      {busy === null ? (
        <EmptyState icon={CircleAlert} title="Availability couldn't be loaded">
          Please refresh the page in a moment.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No rooms match"
          action={
            <Button asChild variant="outline">
              <Link href={toSearch({ ...query, room: "", capacity: "" })}>Show all rooms</Link>
            </Button>
          }
        >
          {capacityFilter && capacityFilter > largest
            ? `The largest room holds ${largest} people.`
            : "Try a different room or number of people."}
        </EmptyState>
      ) : (
        <ul className="grid gap-6 lg:grid-cols-2">
          {shown.map((room) => (
            <li key={room.id}>
              <RoomDay
                room={room}
                today={today}
                window={window}
                busy={busy.get(room.id) ?? []}
                range={query.from && query.to ? { from: query.from, to: query.to } : null}
              />
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-container flex flex-col gap-6 py-10 sm:py-14">
      <PageHeader
        title="Check Availability"
        description="Pick a date to see when each room is open. Unavailable times may be reserved or awaiting approval."
      />
      {children}
    </div>
  );
}

function RoomDay({
  room,
  today,
  window,
  busy,
  range,
}: {
  room: PublicRoom;
  today: string;
  window: DayWindow;
  busy: BusyBlock[];
  range: { from: string; to: string } | null;
}) {
  const withinHorizon = isWithinHorizon(window.date, today, room.advance);
  const rangeFree = range && room.reservable && withinHorizon ? isRangeAvailable(window, busy, range.from, range.to) : null;

  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border bg-card p-5" aria-labelledby={`room-${room.id}`}>
      <div className="flex flex-col gap-3">
        <h3 id={`room-${room.id}`} className="text-lg font-semibold">
          <Link href={`/rooms/${room.slug}`} className="hover:underline">
            {room.name}
          </Link>
        </h3>
        <div className="flex flex-wrap gap-2">
          <CapacityBadge capacity={room.capacity} />
          <ApprovalBadge required={room.approvalRequired} />
          <FoodPolicyBadge allowed={room.foodDrinksAllowed} />
        </div>
      </div>

      {!room.reservable ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Temporarily unavailable.</strong>{" "}
            {room.unavailableMessage ?? "This room can't be reserved right now."}
          </span>
        </p>
      ) : !withinHorizon ? (
        <p className="flex items-start gap-2 rounded-lg bg-info-soft p-3 text-sm text-info-soft-foreground">
          <CalendarX2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            This room may only be reserved up to {advanceLabel(room.advance)} in advance — currently through{" "}
            {formatLongDate(horizonDate(today, room.advance))}.
          </span>
        </p>
      ) : (
        <>
          {range ? (
            rangeFree ? (
              <p className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm font-medium text-success-soft-foreground">
                <CircleCheck className="size-4 shrink-0" aria-hidden />
                Available {formatTimeRange(range.from, range.to)}
              </p>
            ) : (
              <p className="flex items-center gap-2 rounded-lg border border-neutral-border bg-neutral-soft p-3 text-sm font-medium text-neutral-soft-foreground">
                <CircleX className="size-4 shrink-0" aria-hidden />
                Not available {formatTimeRange(range.from, range.to)}
              </p>
            )
          ) : null}
          <DayTimeline
            segments={daySegments(window, busy)}
            dayStart={window.dayStart}
            dayEnd={window.dayEnd}
            reserveHref={(start) => reserveLink(room.slug, window.date, start)}
          />
          <Button asChild className="mt-auto">
            <Link href={reserveLink(room.slug, window.date, rangeFree ? range?.from : undefined, rangeFree ? range?.to : undefined)}>
              Reserve {room.name}
            </Link>
          </Button>
        </>
      )}
    </article>
  );
}
