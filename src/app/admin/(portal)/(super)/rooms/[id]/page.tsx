import { ArrowLeft, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RoomEditor } from "@/components/admin/room-editor";
import { RoomPhoto } from "@/components/admin/room-photo";
import { PageHeader } from "@/components/layout/page-header";
import { loadCatalog } from "@/lib/data/catalog";
import { listAmenities, listRooms } from "@/lib/data/super";
import { isSupabaseConfigured } from "@/lib/env/public";
import { roomImageUrl } from "@/lib/supabase/public";

export const metadata: Metadata = {
  title: "Edit room",
};

export default async function EditRoomPage({ params, searchParams }: PageProps<"/admin/rooms/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  const [rooms, amenities, catalog] = await Promise.all([listRooms(), listAmenities(), loadCatalog()]);
  const room = rooms.find((r) => r.id === id);
  if (!room) notFound();
  const defaultAdvance = catalog.ok ? catalog.catalog.settings.defaultAdvance : { value: 8, unit: "week" as const };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href="/admin/rooms" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All rooms
      </Link>
      {created === "1" ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm text-success-soft-foreground">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          Room created. Add a photo below if you have one.
        </p>
      ) : null}
      <PageHeader
        title={room.name}
        description={
          <>
            Public page:{" "}
            <Link href={`/rooms/${room.slug}`} className="underline underline-offset-4">
              /rooms/{room.slug}
            </Link>
          </>
        }
      />
      <RoomPhoto roomId={room.id} roomName={room.name} imageUrl={isSupabaseConfigured() ? roomImageUrl(room.image_path) : null} />
      <RoomEditor
        key={room.updated_at}
        defaultAdvance={defaultAdvance}
        amenities={amenities}
        room={{
          id: room.id,
          name: room.name,
          slug: room.slug,
          description: room.description ?? "",
          location: room.location ?? "",
          capacity: room.capacity,
          sortOrder: room.sort_order,
          active: room.active,
          reservable: room.reservable,
          unavailableMessage: room.unavailable_message ?? "",
          approvalRequired: room.approval_required,
          foodDrinksAllowed: room.food_drinks_allowed,
          advance: room.max_advance_value !== null && room.max_advance_unit !== null ? { value: room.max_advance_value, unit: room.max_advance_unit } : null,
          amenityIds: room.amenity_ids,
        }}
      />
    </div>
  );
}
