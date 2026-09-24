import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Check Availability",
  description: "See when rooms are open before you reserve.",
};

export default function AvailabilityPage() {
  return (
    <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
      <PageHeader title="Check Availability" description="See when rooms are open before you reserve." />
      <UpcomingFeature title="Availability is on the way">You&apos;ll be able to pick a date and see which rooms and times are open. Details of other people&apos;s reservations are never shown.</UpcomingFeature>
    </div>
  );
}
