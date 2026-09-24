import type { Metadata } from "next";

import { RoomEditor } from "@/components/admin/room-editor";
import { PageHeader } from "@/components/layout/page-header";
import { loadCatalog } from "@/lib/data/catalog";
import { listAmenities, listRooms } from "@/lib/data/super";

export const metadata: Metadata = {
  title: "Add room",
};

export default async function NewRoomPage() {
  const [amenities, rooms, catalog] = await Promise.all([listAmenities(), listRooms(), loadCatalog()]);
  const defaultAdvance = catalog.ok ? catalog.catalog.settings.defaultAdvance : { value: 8, unit: "week" as const };
  const nextOrder = Math.max(0, ...rooms.map((r) => r.sort_order)) + 10;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Add room" description="You can add a photo after the room is created." />
      <RoomEditor
        defaultAdvance={defaultAdvance}
        amenities={amenities}
        room={{
          id: null,
          name: "",
          slug: "",
          description: "",
          location: "",
          capacity: 10,
          sortOrder: nextOrder,
          active: true,
          reservable: true,
          unavailableMessage: "",
          approvalRequired: true,
          foodDrinksAllowed: false,
          advance: null,
          amenityIds: [],
        }}
      />
    </div>
  );
}
