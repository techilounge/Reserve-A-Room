import { Archive, CalendarClock, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { AdvanceBadge, ApprovalBadge, CapacityBadge, FoodPolicyBadge, PolicyPill } from "@/components/rooms/policy-badges";
import { Button } from "@/components/ui/button";
import { loadCatalog } from "@/lib/data/catalog";
import { listRooms } from "@/lib/data/super";
import { effectiveAdvanceRule } from "@/lib/domain/rooms/advance-booking";

export const metadata: Metadata = {
  title: "Rooms",
};

export default async function AdminRoomsPage() {
  const [rooms, catalog] = await Promise.all([listRooms(), loadCatalog()]);
  const defaults = catalog.ok
    ? {
        default_max_advance_value: catalog.catalog.settings.defaultAdvance.value,
        default_max_advance_unit: catalog.catalog.settings.defaultAdvance.unit,
      }
    : { default_max_advance_value: 8, default_max_advance_unit: "week" as const };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rooms"
        description="Rooms and their reservation rules. Archive rooms instead of deleting them so history is kept."
        actions={
          <Button asChild>
            <Link href="/admin/rooms/new">
              <Plus data-icon="inline-start" aria-hidden />
              Add room
            </Link>
          </Button>
        }
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {rooms.map((room) => (
          <li key={room.id}>
            <Link href={`/admin/rooms/${room.id}`} className="flex h-full flex-col gap-3 rounded-xl border bg-card p-5 hover:border-ring">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{room.name}</h2>
                {!room.active ? (
                  <PolicyPill icon={Archive}>Archived</PolicyPill>
                ) : !room.reservable ? (
                  <PolicyPill icon={Archive} tone="warning">
                    Temporarily unavailable
                  </PolicyPill>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <CapacityBadge capacity={room.capacity} />
                <ApprovalBadge required={room.approval_required} />
                <FoodPolicyBadge allowed={room.food_drinks_allowed} />
                <AdvanceBadge rule={effectiveAdvanceRule(room, defaults)} />
              </div>
              <p className="mt-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarClock className="size-4" aria-hidden />
                {room.upcoming_count} upcoming reservation{room.upcoming_count === 1 ? "" : "s"}
                {room.max_advance_value === null ? " · uses default booking window" : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
