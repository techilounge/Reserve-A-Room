import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Reservations",
};

export default function AdminReservationsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Reservations" description="Search, review and manage every reservation." />
      <UpcomingFeature title="Reservation management is on the way">You&apos;ll be able to search, filter, approve, decline, edit and cancel reservations here.</UpcomingFeature>
    </div>
  );
}
