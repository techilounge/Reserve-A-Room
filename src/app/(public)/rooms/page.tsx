import { DoorClosed } from "lucide-react";
import type { Metadata } from "next";

import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { RoomCard } from "@/components/rooms/room-card";
import { loadCatalog } from "@/lib/data/catalog";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Rooms",
  description: "Rooms available for Stonehill ministries and groups, with capacity and reservation policies.",
};

export default async function RoomsPage() {
  const result = await loadCatalog();

  return (
    <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
      <PageHeader
        title="Rooms"
        description="Browse rooms available for Stonehill ministries and groups. Each room lists its capacity and reservation policies."
      />
      {!result.ok ? (
        <CatalogUnavailable reason={result.reason} />
      ) : result.catalog.rooms.length === 0 ? (
        <EmptyState icon={DoorClosed} title="No rooms are available yet">
          Rooms will appear here once the church office adds them.
        </EmptyState>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {result.catalog.rooms.map((room) => (
            <RoomCard key={room.id} room={room} headingLevel="h2" />
          ))}
        </div>
      )}
    </div>
  );
}
