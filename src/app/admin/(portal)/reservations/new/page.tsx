import type { Metadata } from "next";

import { StaffReservationForm } from "@/components/admin/staff-reservation-form";
import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { PageHeader } from "@/components/layout/page-header";
import { loadCatalog } from "@/lib/data/catalog";
import { reserveContext } from "@/lib/reservations/reserve-context";

export const metadata: Metadata = {
  title: "New reservation",
};

export default async function NewReservationPage() {
  const catalog = await loadCatalog();
  if (!catalog.ok) return <CatalogUnavailable reason={catalog.reason} />;
  const { rooms, settings, today } = reserveContext(catalog.catalog);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="New reservation"
        description="Reserve a room on someone's behalf. It is confirmed immediately and follows every room rule."
      />
      <StaffReservationForm
        mode="create"
        rooms={rooms}
        ministries={catalog.catalog.ministries}
        settings={settings}
        today={today}
        defaults={{
          roomId: rooms.length === 1 ? rooms[0].id : "",
          date: "",
          start: "",
          end: "",
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          ministryId: "",
          otherMinistryName: "",
          purpose: "",
          estimatedAttendance: "",
          setupRequirements: "",
          requesterNotes: "",
        }}
      />
    </div>
  );
}
