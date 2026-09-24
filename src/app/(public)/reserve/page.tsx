import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Reserve a Room",
  description: "Choose a room and time, tell us about your reservation, then review and submit.",
};

export default function ReservePage() {
  return (
    <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
      <PageHeader title="Reserve a Room" description="Choose a room and time, tell us about your reservation, then review and submit." />
      <UpcomingFeature title="Online reservations are on the way">Reservations open once rooms and availability are connected. No account will be needed.</UpcomingFeature>
    </div>
  );
}
