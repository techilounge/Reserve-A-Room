import { ArrowLeft, CircleAlert, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { AmenityList } from "@/components/rooms/amenity-list";
import { ApprovalBadge, CapacityBadge, FoodPolicyBadge } from "@/components/rooms/policy-badges";
import { RoomImage } from "@/components/rooms/room-image";
import { RoomPolicyPanel } from "@/components/rooms/room-policy-panel";
import { Button } from "@/components/ui/button";
import { findRoom, loadCatalog } from "@/lib/data/catalog";

export const revalidate = 300;

export async function generateMetadata({ params }: PageProps<"/rooms/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadCatalog();
  const room = result.ok ? findRoom(result.catalog, slug) : undefined;
  if (!room) return { title: "Room" };
  return {
    title: room.name,
    description: room.description ?? `Reserve the ${room.name} at Stonehill SDA Church. Capacity ${room.capacity}.`,
  };
}

export default async function RoomDetailsPage({ params }: PageProps<"/rooms/[slug]">) {
  const { slug } = await params;
  const result = await loadCatalog();

  if (!result.ok) {
    return (
      <div className="page-container py-10 sm:py-14">
        <CatalogUnavailable reason={result.reason} />
      </div>
    );
  }

  const room = findRoom(result.catalog, slug);
  if (!room) notFound();

  return (
    <div className="page-container flex flex-col gap-8 py-8 sm:py-12">
      <Link
        href="/rooms"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All rooms
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <RoomImage
          src={room.imageUrl}
          name={room.name}
          priority
          sizes="(min-width: 1024px) 38rem, 100vw"
          className="rounded-xl border"
        />
        <div className="flex flex-col gap-5">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{room.name}</h1>
            {room.location ? (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="size-4" aria-hidden />
                {room.location}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <CapacityBadge capacity={room.capacity} />
            <ApprovalBadge required={room.approvalRequired} />
            <FoodPolicyBadge allowed={room.foodDrinksAllowed} />
          </div>
          {room.description ? <p className="text-foreground/90">{room.description}</p> : null}
          {room.amenities.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Amenities</h2>
              <AmenityList amenities={room.amenities} />
            </div>
          ) : null}

          {room.reservable ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg" className="sm:flex-1">
                <Link href={`/reserve?room=${room.slug}`}>Reserve this room</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="sm:flex-1">
                <Link href={`/availability?room=${room.slug}`}>Check availability</Link>
              </Button>
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-4 text-sm text-warning-soft-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">Temporarily unavailable.</strong>{" "}
                {room.unavailableMessage ?? "This room can't be reserved right now. Please choose another room."}
              </span>
            </p>
          )}
        </div>
      </div>

      <RoomPolicyPanel room={room} timeZone={result.catalog.settings.timeZone} />
    </div>
  );
}
