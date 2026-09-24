import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { AmenityList } from "@/components/rooms/amenity-list";
import {
  AdvanceBadge,
  ApprovalBadge,
  CapacityBadge,
  FoodPolicyBadge,
  LocationBadge,
} from "@/components/rooms/policy-badges";
import { RoomImage } from "@/components/rooms/room-image";
import { Button } from "@/components/ui/button";
import type { PublicRoom } from "@/lib/data/catalog";

export function RoomCard({ room, headingLevel = "h3" }: { room: PublicRoom; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <Link href={`/rooms/${room.slug}`} tabIndex={-1} aria-hidden>
        <RoomImage src={room.imageUrl} name={room.name} sizes="(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 100vw" />
      </Link>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="space-y-1.5">
          <Heading className="text-lg font-semibold">
            <Link href={`/rooms/${room.slug}`} className="hover:underline">
              {room.name}
            </Link>
          </Heading>
          {room.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{room.description}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <CapacityBadge capacity={room.capacity} />
          <ApprovalBadge required={room.approvalRequired} />
          <FoodPolicyBadge allowed={room.foodDrinksAllowed} />
          <AdvanceBadge rule={room.advance} />
          {room.location ? <LocationBadge location={room.location} /> : null}
        </div>

        <AmenityList amenities={room.amenities} limit={4} />

        {!room.reservable ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Temporarily unavailable.</strong>{" "}
              {room.unavailableMessage ?? "This room can't be reserved right now."}
            </span>
          </p>
        ) : null}

        <div className="mt-auto flex flex-col gap-2 pt-1 sm:flex-row">
          {room.reservable ? (
            <Button asChild className="sm:flex-1">
              <Link href={`/reserve?room=${room.slug}`}>
                Reserve<span className="sr-only"> {room.name}</span>
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="sm:flex-1">
            <Link href={`/availability?room=${room.slug}`}>
              Check availability<span className="sr-only"> for {room.name}</span>
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
