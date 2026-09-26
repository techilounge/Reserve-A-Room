import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaffReservationForm } from "@/components/admin/staff-reservation-form";
import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/format";
import { toLocalParts } from "@/lib/datetime";
import { getReservation } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";
import { reserveContext } from "@/lib/reservations/reserve-context";
import { OTHER_MINISTRY } from "@/lib/validation/reservation";

export const metadata: Metadata = {
  title: "Edit reservation",
};

export default async function EditReservationPage({ params }: PageProps<"/admin/reservations/[id]/edit">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [r, catalog] = await Promise.all([getReservation(id), loadCatalog()]);
  if (!r) notFound();
  if (!catalog.ok) return <CatalogUnavailable reason={catalog.reason} />;

  if (r.status !== "pending" && r.status !== "approved") {
    return (
      <EmptyState
        icon={Info}
        title="This reservation can't be edited"
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/reservations/${r.id}`}>Back to reservation</Link>
          </Button>
        }
      >
        {r.status === "declined" ? "Declined" : "Cancelled"} reservations are kept as history. Create a new reservation instead.
      </EmptyState>
    );
  }

  const { rooms, settings, today } = reserveContext(catalog.catalog);
  const start = toLocalParts(r.start_at, settings.timeZone);
  const end = toLocalParts(r.end_at, settings.timeZone);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`Edit ${r.reference_code}`}
        description="Changing the room, date or time re-checks availability and the room's rules. The status stays the same."
      />
      <StaffReservationForm
        mode="edit"
        reservationId={r.id}
        rooms={rooms}
        ministries={catalog.catalog.ministries}
        settings={settings}
        today={today}
        isApproved={r.status === "approved"}
        original={{ roomId: r.room_id, startAt: r.start_at, endAt: r.end_at }}
        adminNotes={r.admin_notes ?? ""}
        defaults={{
          roomId: r.room_id,
          date: start.date,
          start: start.time,
          end: end.time,
          firstName: r.requester_first_name,
          lastName: r.requester_last_name,
          email: r.requester_email,
          phone: formatPhone(r.requester_phone),
          ministryId: r.ministry_id ?? OTHER_MINISTRY,
          otherMinistryName: r.other_ministry_name ?? "",
          purpose: r.purpose,
          estimatedAttendance: String(r.estimated_attendance),
          setupRequirements: r.setup_requirements ?? "",
          requesterNotes: r.requester_notes ?? "",
          legalAccepted: true,
        }}
      />
    </div>
  );
}
