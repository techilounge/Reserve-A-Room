import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Your Reservation",
  robots: { index: false, follow: false },
};

export default function ReservationStatusPage() {
  return (
    <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
      <PageHeader title="Your Reservation" />
      <UpcomingFeature title="Reservation details are on the way">
        This page will show your reservation&apos;s status using the secure link from your confirmation email.
      </UpcomingFeature>
    </div>
  );
}
